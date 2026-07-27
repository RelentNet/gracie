/**
 * Generation-prompt settings data layer (Settings → Generation Prompts, PE).
 * Admin-only surface over ONE jsonb setting, `generation_prompt_overrides`, an
 * object `{ [docType]: string }` of per-document prompt overrides. A doc with no
 * (or blank) override inherits the shared default (`DEFAULT_GENERATION_PROMPTS`),
 * which is the SAME source the worker falls back to — so the UI's "effective" text
 * is exactly what generation uses.
 *
 * We store only genuine overrides: any submitted value that is blank or equal to the
 * default is dropped, so the row stays minimal and "Reset to default" just means
 * "remove this doc's entry". Server-only (service-role client); permission
 * enforcement is the API layer's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import {
  DEFAULT_GENERATION_PROMPTS,
  GENERATED_DOC_SPECS,
  type GeneratedDocType,
} from '@gracie/shared';

const OVERRIDES_KEY = 'generation_prompt_overrides';
/** A single prompt is generous but bounded — guards against absurd payloads. */
const MAX_PROMPT_LEN = 20000;

const DOC_TYPES = new Set<string>(GENERATED_DOC_SPECS.map((s) => s.type));

/** One doc's editable prompt, in generation order (what the panel renders). */
export interface GenerationPromptDoc {
  readonly type: GeneratedDocType;
  readonly label: string;
  readonly order: number;
  readonly defaultPrompt: string;
  /** Override if one is stored, else the default — what generation actually uses. */
  readonly effectivePrompt: string;
  readonly isOverridden: boolean;
  /** True for the Task Checklist — its JSON response shape must be preserved. */
  readonly requiresJsonShape: boolean;
}

/** Thrown on invalid input so the route can answer 400 (vs. 500). */
export class GenerationPromptsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationPromptsValidationError';
  }
}

/** Read the stored overrides object (defensive about shape → {} on anything odd). */
async function readOverrides(): Promise<Record<string, string>> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', OVERRIDES_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getGenerationPrompts: ${error.message}`);

  const raw = data?.value;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DOC_TYPES.has(key) && typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

/** The six docs with their default + effective prompt, in generation order. */
export async function getGenerationPrompts(): Promise<GenerationPromptDoc[]> {
  const overrides = await readOverrides();
  return GENERATED_DOC_SPECS.map((spec) => {
    const override = overrides[spec.type];
    const isOverridden = typeof override === 'string' && override.trim() !== '';
    return {
      type: spec.type,
      label: spec.label,
      order: spec.order,
      defaultPrompt: DEFAULT_GENERATION_PROMPTS[spec.type],
      effectivePrompt: isOverridden ? override : DEFAULT_GENERATION_PROMPTS[spec.type],
      isOverridden,
      requiresJsonShape: spec.responseFormat === 'json',
    };
  });
}

/**
 * Persist per-doc overrides. `overrides` maps doc type → desired prompt; a value
 * that is blank OR equal to the default is dropped (that doc resets to default).
 * Unknown doc-type keys and non-string values are rejected (400). Returns the fresh
 * doc list.
 */
export async function setGenerationPromptOverrides(
  overrides: Record<string, unknown>,
  updatedByUserId: string | null,
): Promise<GenerationPromptDoc[]> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!DOC_TYPES.has(key)) {
      throw new GenerationPromptsValidationError(`Unknown document type: ${key}`);
    }
    if (typeof value !== 'string') {
      throw new GenerationPromptsValidationError(`Prompt for ${key} must be text.`);
    }
    if (value.length > MAX_PROMPT_LEN) {
      throw new GenerationPromptsValidationError(
        `Prompt for ${key} must be ${MAX_PROMPT_LEN} characters or fewer.`,
      );
    }
    const trimmed = value.trim();
    // Blank or unchanged-from-default → no override (reset to default).
    if (trimmed === '' || trimmed === DEFAULT_GENERATION_PROMPTS[key as GeneratedDocType].trim()) {
      continue;
    }
    cleaned[key] = value;
  }

  const db = getServerClient();
  const { error } = await db.from('settings').upsert(
    [
      {
        key: OVERRIDES_KEY,
        value: cleaned,
        updated_by_user_id: updatedByUserId,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setGenerationPromptOverrides: ${error.message}`);
  return getGenerationPrompts();
}
