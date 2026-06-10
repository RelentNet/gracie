/**
 * 5-layer prompt assembly (docs/06 §2). Builds the system portion (layers 1–5)
 * and the user message (layer 6 = source content), and injects the global prompt
 * rules (docs/06 §3): the [VERIFY: ...] uncertainty rule, professional federal
 * healthcare-consulting tone, and — for the task checklist — the strict-JSON rule.
 *
 * The per-document instruction (layer 3) is supplied by the caller, so prompt
 * wording lives with the pipeline (P5), not in @gracie/shared.
 */
import type { AIMessage } from '../provider.js';

/** The six context layers (docs/06 §2). Layers 1–5 → system; layer 6 → user. */
export interface PromptContext {
  /** Layer 1 — settings.ga_company_description. */
  readonly gaCompanyDescription: string;
  /** Layer 2 — clients.description. */
  readonly clientDescription: string;
  /** Layer 3 — document-/meeting-type instruction (what we're generating). */
  readonly documentInstruction: string;
  /** Layer 4 — consultant context (per-file upload notes or meeting notes). */
  readonly consultantContext: string;
  /** Layer 5 — historical context (recent summaries + open items). */
  readonly historicalContext: string;
  /** Layer 6 — source content (transcript or uploaded file text). */
  readonly sourceContent: string;
}

export interface AssembledPrompt {
  readonly system: string;
  readonly messages: readonly AIMessage[];
}

const VERIFY_RULE =
  'When any statement is uncertain, inferred, or not directly supported by the source content, wrap it in [VERIFY: ...] so a human can confirm it. Never present speculation as fact.';

const TONE_RULE =
  'Write in a polished, professional federal healthcare-consulting tone. Be precise and concise; avoid filler.';

const JSON_RULE =
  'Respond with ONLY a single valid JSON object matching the requested schema — no prose, no markdown fences.';

function section(title: string, body: string): string {
  const content = body.trim() === '' ? '(none provided)' : body.trim();
  return `## ${title}\n${content}`;
}

/**
 * Assemble the 5-layer system prompt + user message. Pass
 * `responseFormat: 'json'` for the task-checklist step to append the JSON rule.
 */
export function assemblePrompt(
  context: PromptContext,
  options?: { readonly responseFormat?: 'text' | 'json' },
): AssembledPrompt {
  const rules = [VERIFY_RULE, TONE_RULE];
  if (options?.responseFormat === 'json') {
    rules.push(JSON_RULE);
  }

  const system = [
    section('About Grace & Associates', context.gaCompanyDescription),
    section('About the Client', context.clientDescription),
    section('Your Task', context.documentInstruction),
    section('Consultant Context', context.consultantContext),
    section('Historical Context', context.historicalContext),
    section('Rules', rules.join('\n')),
  ].join('\n\n');

  return {
    system,
    messages: [{ role: 'user', content: context.sourceContent }],
  };
}
