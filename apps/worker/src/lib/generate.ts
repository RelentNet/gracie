/**
 * Generation core (P5b, docs/06 §2/§4/§6). Pipeline-agnostic: given a transcript
 * (or uploaded source) plus the surrounding 5-layer context, it runs the SIX
 * generated documents SEQUENTIALLY in the fixed order (D7, `GENERATED_DOC_ORDER`)
 * and returns the outputs + the parsed task list.
 *
 * Boundaries (keep it reusable from both the meeting processor and, later, the
 * upload path):
 *   - NO database, storage, or queue access here — callers own persistence.
 *   - AI ONLY through the injected provider interface (D11); never the SDK.
 *   - The per-document instruction (layer 3) lives HERE, not in @gracie/shared,
 *     so prompt wording stays tunable with the pipeline (assembly.ts contract).
 *
 * Task extraction (docs/06 §6/§8): the Task Checklist step requests JSON; on an
 * unparseable response we do ONE stricter re-ask, then give up — `tasks` comes
 * back `null` so the caller stores the checklist doc and skips the task insert.
 */
import {
  GENERATED_DOC_SPECS,
  TaskExtractionError,
  assemblePrompt,
  getDocSpec,
  parseTaskExtraction,
  type AIProvider,
  type ExtractedTask,
  type GeneratedDocSpec,
  type GeneratedDocType,
} from '@gracie/shared';
import type { FastifyBaseLogger } from 'fastify';

/** Context the caller supplies for one generation run (layers 1–2, 4–6 of docs/06 §2). */
export interface GenerationContext {
  /** Layer 1 — settings.ga_company_description. */
  readonly gaCompanyDescription: string;
  /** Layer 2 — clients.description. */
  readonly clientDescription: string;
  /** Layer 4 — consultant/meeting context (meeting title, type, attendees, …). */
  readonly consultantContext: string;
  /** Layer 5 — historical context (recent summaries + open items). */
  readonly historicalContext: string;
  /** Layer 6 — source content (the transcript text). */
  readonly sourceContent: string;
}

/** One generated document — the raw model output plus its spec (docs/06 §3). */
export interface GeneratedDocument {
  readonly type: GeneratedDocType;
  readonly spec: GeneratedDocSpec;
  readonly content: string;
}

export interface GenerationResult {
  /** The six documents, in generation order (docs/06 §4). */
  readonly documents: readonly GeneratedDocument[];
  /**
   * Parsed task list from the Task Checklist step, or `null` when the JSON was
   * still invalid after one stricter re-ask (docs/06 §8 — store the doc, skip the
   * task insert).
   */
  readonly tasks: readonly ExtractedTask[] | null;
}

export interface GenerateDocumentsInput {
  readonly provider: AIProvider;
  readonly model: string;
  readonly context: GenerationContext;
  /**
   * Effective per-doc instruction (layer 3 — "Your Task") for all six doc types,
   * already resolved override-else-default by the caller (PE). Build it with
   * `resolveGenerationPrompts(...)` from @gracie/shared so every type is present.
   */
  readonly prompts: Record<GeneratedDocType, string>;
  readonly logger: FastifyBaseLogger;
}

/**
 * Stricter re-ask instruction for the Task Checklist when the first response did
 * not parse (docs/06 §8). Re-states the schema and forbids any non-JSON output.
 */
const TASK_CHECKLIST_STRICT_INSTRUCTION = [
  'Your previous response could not be parsed as JSON. Re-extract the follow-up',
  'tasks and respond with NOTHING but a single, strictly valid JSON object exactly',
  'matching: {"tasks":[{"description":string,"owner_hint":string|null,"due_hint":',
  'string|null,"priority":boolean}]}. Do not include explanations, comments, or',
  'Markdown code fences. If there are no tasks, return {"tasks":[]}.',
].join(' ');

/**
 * Editable generation prompts (PE, #60) may open with a documentation preamble — a
 * title heading plus a fenced YAML metadata block (`template_id:`, `output_filename:`,
 * …) that documents the template rather than instructing the model. The model
 * sometimes copies that preamble verbatim to the TOP of its output, so the stored
 * document — and the `master_record_entries` digest derived from it (which briefs +
 * the occurrence page surface) — begins with a raw YAML dump instead of prose.
 *
 * Strip a reproduced leading scaffold: leading blank/heading/`---` lines followed by
 * a fenced YAML (or `template_id:`-bearing) block, back to the real body. Deliberately
 * conservative — only a fenced block at the very START, before any prose, and only
 * when it looks like metadata — so a document that legitimately quotes YAML further
 * down, or a JSON checklist, is never touched. No-op when there is no such scaffold.
 */
export function stripReproducedScaffold(content: string): string {
  const lines = content.split('\n');
  let i = 0;
  // Skip leading blanks, markdown headings, and horizontal rules.
  while (i < lines.length && /^\s*(#{1,6}\s.*|-{3,}\s*)?$/.test(lines[i] ?? '')) i++;
  // A scaffold only exists if a fenced block opens here; otherwise leave content as-is.
  const fenceOpen = /^\s*```\s*([\w-]*)\s*$/.exec(lines[i] ?? '');
  if (fenceOpen === null) return content;
  // Collect the fenced block body up to its closing fence.
  let j = i + 1;
  const body: string[] = [];
  while (j < lines.length && !/^\s*```\s*$/.test(lines[j] ?? '')) body.push(lines[j++] ?? '');
  if (j >= lines.length) return content; // unterminated fence — don't touch it
  const lang = (fenceOpen[1] ?? '').toLowerCase();
  const looksLikeMetadata =
    lang === 'yaml' ||
    lang === 'yml' ||
    /^\s*(template_id|output_filename|run_order|audience|review_status)\s*:/m.test(body.join('\n'));
  if (!looksLikeMetadata) return content;
  // Drop everything through the closing fence, plus any leading blanks/`---` after it.
  let k = j + 1;
  while (k < lines.length && /^\s*(-{3,}\s*)?$/.test(lines[k] ?? '')) k++;
  return lines.slice(k).join('\n');
}

/** Generate one document via the provider interface, returning the raw content. */
async function generateOne(
  input: GenerateDocumentsInput,
  spec: GeneratedDocSpec,
  instruction: string,
): Promise<string> {
  const { system, messages } = assemblePrompt(
    { ...input.context, documentInstruction: instruction },
    { responseFormat: spec.responseFormat },
  );
  const result = await input.provider.generate({
    model: input.model,
    system,
    messages,
    responseFormat: spec.responseFormat,
  });
  return stripReproducedScaffold(result.content);
}

/**
 * Run the full 6-document generation pipeline SEQUENTIALLY (D7). Returns the six
 * documents in order plus the parsed task list (or `null` if it never parsed).
 * Provider/storage failures propagate so the caller can mark the run failed.
 */
export async function generateDocuments(
  input: GenerateDocumentsInput,
): Promise<GenerationResult> {
  const documents: GeneratedDocument[] = [];
  let tasks: readonly ExtractedTask[] | null = null;

  // Sequential — one provider call at a time, in the fixed order (D7).
  for (const spec of GENERATED_DOC_SPECS) {
    input.logger.info({ docType: spec.type, order: spec.order }, 'generate: document');
    const content = await generateOne(input, spec, input.prompts[spec.type]);
    documents.push({ type: spec.type, spec, content });

    if (spec.type === 'task_checklist') {
      tasks = await parseChecklist(input, content);
    }
  }

  return { documents, tasks };
}

/**
 * Parse the Task Checklist output, with one stricter re-ask on failure
 * (docs/06 §8). Returns the parsed tasks, or `null` if still invalid.
 */
async function parseChecklist(
  input: GenerateDocumentsInput,
  firstContent: string,
): Promise<readonly ExtractedTask[] | null> {
  try {
    return parseTaskExtraction(firstContent).tasks;
  } catch (error) {
    if (!(error instanceof TaskExtractionError)) throw error;
    input.logger.warn(
      { err: error.message },
      'generate: task checklist JSON invalid — one stricter re-ask',
    );
  }

  const retryContent = await generateOne(
    input,
    getDocSpec('task_checklist'),
    TASK_CHECKLIST_STRICT_INSTRUCTION,
  );
  try {
    return parseTaskExtraction(retryContent).tasks;
  } catch (error) {
    if (!(error instanceof TaskExtractionError)) throw error;
    input.logger.warn(
      { err: error.message },
      'generate: task checklist still invalid after re-ask — skipping task insert',
    );
    return null;
  }
}
