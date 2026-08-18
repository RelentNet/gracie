/**
 * AI settings data layer (Settings → AI). Admin-only surface over the active
 * generation PROVIDER (`settings.ai_provider`) + MODEL (`settings.ai_model`) and the
 * per-provider API key (stored encrypted in `integration_credentials`, one slot per
 * provider so keys persist across switches).
 *
 * Provider + model are stored as JSON STRINGS to match the reader in `@gracie/db`
 * (`getActiveProvider` → `getSettingString`), so a change takes effect on the next
 * generation/chat request with no restart. The embedding model is PINNED to OpenAI
 * (D9) — changing it would invalidate every stored vector — so it is exposed
 * read-only and can never be set here; an OpenAI key is therefore required for
 * embeddings even when generation runs on another provider.
 *
 * Server-only (service-role client); permission enforcement is the API layer's job.
 */
import 'server-only';

import { getServerClient, listIntegrations, setIntegration } from '@gracie/db';
import {
  DEFAULT_GENERATION_MODEL,
  DEFAULT_GENERATION_PROVIDER,
  estimateCentsPerMeetingHour,
  findModel,
  isProviderId,
  listModelsForProvider,
  PINNED_EMBEDDING_MODEL,
  PROVIDER_IDS,
  PROVIDER_LABELS,
} from '@gracie/shared';

const AI_PROVIDER_SETTING_KEY = 'ai_provider';
const AI_MODEL_SETTING_KEY = 'ai_model';

/** One model option shown in the picker (with its rough per-hour cost estimate). */
export interface ModelOption {
  readonly model: string;
  readonly label: string;
  readonly supportsTools: boolean;
  readonly supportsJson: boolean;
  /** Rough estimate: cents to process one hour of meetings on this model. */
  readonly centsPerMeetingHour: number;
}

/** One provider option (the "Company" dropdown) + its models + whether a key is stored. */
export interface ProviderOption {
  readonly providerId: string;
  readonly label: string;
  /** True when an API key is stored for this provider (env fallback not counted). */
  readonly keyIsSet: boolean;
  readonly models: readonly ModelOption[];
}

export interface AiSettings {
  /** The active generation/chat provider. */
  readonly provider: string;
  /** The active generation/chat model. */
  readonly model: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  /** Read-only: the pinned embedding model + its provider (never settable here). */
  readonly embeddingModel: string;
  readonly embeddingProvider: string;
  /** All selectable providers + their models + key status. */
  readonly providers: readonly ProviderOption[];
}

function toModelOptions(providerId: string): ModelOption[] {
  return listModelsForProvider(providerId).map((m) => ({
    model: m.model,
    label: m.label,
    supportsTools: m.supportsTools,
    supportsJson: m.supportsJson,
    centsPerMeetingHour: estimateCentsPerMeetingHour(m),
  }));
}

/** Read current AI settings (defaults merged in) + per-provider key status. */
export async function getAiSettings(): Promise<AiSettings> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('key, value')
    .in('key', [AI_PROVIDER_SETTING_KEY, AI_MODEL_SETTING_KEY]);
  if (error !== null) throw new Error(`getAiSettings: ${error.message}`);

  const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
  const storedProvider = byKey.get(AI_PROVIDER_SETTING_KEY);
  const storedModel = byKey.get(AI_MODEL_SETTING_KEY);
  const provider =
    typeof storedProvider === 'string' && isProviderId(storedProvider)
      ? storedProvider
      : DEFAULT_GENERATION_PROVIDER;
  // Keep provider + model consistent: a stale model from a previous provider falls
  // back to that provider's first model (or the global default when provider is default).
  const modelValid = typeof storedModel === 'string' && findModel(provider, storedModel) !== undefined;
  const providerModels = listModelsForProvider(provider);
  const model = modelValid
    ? (storedModel as string)
    : provider === DEFAULT_GENERATION_PROVIDER
      ? DEFAULT_GENERATION_MODEL
      : (providerModels[0]?.model ?? DEFAULT_GENERATION_MODEL);

  const integrations = await listIntegrations();
  const keyIsSet = new Map(integrations.map((i) => [i.service as string, i.isSet]));

  return {
    provider,
    model,
    defaultProvider: DEFAULT_GENERATION_PROVIDER,
    defaultModel: DEFAULT_GENERATION_MODEL,
    embeddingModel: PINNED_EMBEDDING_MODEL,
    embeddingProvider: 'openai',
    providers: PROVIDER_IDS.map((id) => ({
      providerId: id,
      label: PROVIDER_LABELS[id],
      keyIsSet: keyIsSet.get(id) ?? false,
      models: toModelOptions(id),
    })),
  };
}

/** Thrown on an invalid provider/model so the route can answer 400 (vs. 500). */
export class AiSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSettingsValidationError';
  }
}

export interface SetAiParams {
  readonly provider: string;
  readonly model: string;
  /** Optional new API key for the selected provider; blank/omitted keeps the stored key. */
  readonly apiKey?: string;
  readonly updatedByUserId: string | null;
}

/**
 * Set the generation provider + model (and optionally the provider's API key). The
 * (provider, model) pair is validated together so the stored pair is always coherent.
 * Admin-gated at the API layer. Returns the fresh settings.
 */
export async function setAiProviderModel(params: SetAiParams): Promise<AiSettings> {
  if (!isProviderId(params.provider)) {
    throw new AiSettingsValidationError(`“${params.provider}” is not a selectable provider.`);
  }
  if (findModel(params.provider, params.model) === undefined) {
    throw new AiSettingsValidationError(`“${params.model}” is not a valid model for ${params.provider}.`);
  }

  const db = getServerClient();
  const now = new Date().toISOString();
  const { error } = await db.from('settings').upsert(
    [
      { key: AI_PROVIDER_SETTING_KEY, value: params.provider, updated_by_user_id: params.updatedByUserId, updated_at: now },
      { key: AI_MODEL_SETTING_KEY, value: params.model, updated_by_user_id: params.updatedByUserId, updated_at: now },
    ],
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setAiProviderModel: ${error.message}`);

  const key = params.apiKey?.trim();
  if (key !== undefined && key !== '') {
    // ProviderId ⊆ IntegrationKey ('openai' | 'anthropic'); one slot per provider.
    await setIntegration(params.provider, { secret: key, updatedByUserId: params.updatedByUserId });
  }

  return getAiSettings();
}
