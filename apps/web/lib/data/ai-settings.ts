/**
 * AI model settings data layer (Settings → AI Model, P9). Admin-only surface over
 * the generation/chat model (`settings.ai_model`). The embedding model is PINNED
 * (D9) — changing it would invalidate every stored vector — so it is exposed
 * read-only and can never be set here.
 *
 * `ai_model` is stored as a JSON STRING to match the reader in `@gracie/db`
 * (`getActiveProvider` → `getSettingString('ai_model')`), so a change takes effect
 * on the next generation/chat request with no restart. `ai_provider` stays reserved
 * (OpenAI-only today, D11).
 *
 * Server-only (service-role client); permission enforcement is the API layer's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import {
  ALLOWED_GENERATION_MODELS,
  DEFAULT_GENERATION_MODEL,
  isAllowedGenerationModel,
  PINNED_EMBEDDING_MODEL,
} from '@gracie/shared';

const AI_MODEL_SETTING_KEY = 'ai_model';

export interface AiSettings {
  /** The active generation/chat model. */
  readonly model: string;
  /** The models an admin may choose from (curated in shared). */
  readonly allowedModels: readonly string[];
  /** The default used when unset. */
  readonly defaultModel: string;
  /** Read-only: the pinned embedding model (never settable here). */
  readonly embeddingModel: string;
}

/** Read the current AI model settings (defaults merged in). */
export async function getAiSettings(): Promise<AiSettings> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', AI_MODEL_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getAiSettings: ${error.message}`);
  const stored = typeof data?.value === 'string' ? data.value : null;
  const model = stored !== null && isAllowedGenerationModel(stored) ? stored : DEFAULT_GENERATION_MODEL;
  return {
    model,
    allowedModels: ALLOWED_GENERATION_MODELS,
    defaultModel: DEFAULT_GENERATION_MODEL,
    embeddingModel: PINNED_EMBEDDING_MODEL,
  };
}

/** Thrown on an invalid model so the route can answer 400 (vs. 500). */
export class AiSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSettingsValidationError';
  }
}

/**
 * Set the generation/chat model. Rejects any id outside the curated allow-list.
 * Stored as a JSON string to match the `getActiveProvider` reader. Admin-gated at
 * the API layer. Returns the fresh settings.
 */
export async function setAiModel(model: string, updatedByUserId: string): Promise<AiSettings> {
  if (!isAllowedGenerationModel(model)) {
    throw new AiSettingsValidationError(`“${model}” is not a selectable model.`);
  }
  const db = getServerClient();
  const { error } = await db.from('settings').upsert(
    {
      key: AI_MODEL_SETTING_KEY,
      value: model, // JSON string (jsonb holds a string) — matches getSettingString reader.
      updated_by_user_id: updatedByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setAiModel: ${error.message}`);
  return getAiSettings();
}
