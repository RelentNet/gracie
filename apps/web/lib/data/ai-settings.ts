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
  DEFAULT_OLLAMA_BASE_URL,
  estimateCentsPerMeetingHour,
  isProviderId,
  listModelsForProvider,
  PINNED_EMBEDDING_MODEL,
  providerNeedsBaseUrl,
  PROVIDER_IDS,
  PROVIDER_LABELS,
} from '@gracie/shared';

const AI_PROVIDER_SETTING_KEY = 'ai_provider';
const AI_MODEL_SETTING_KEY = 'ai_model';
/** Endpoint (base URL) for OpenAI-compatible providers (Ollama / Custom); plaintext, non-secret. */
const AI_BASE_URL_SETTING_KEY = 'ai_base_url';

/** One model option shown in the picker (with its rough per-hour cost estimate). */
export interface ModelOption {
  readonly model: string;
  readonly label: string;
  readonly supportsTools: boolean;
  readonly supportsJson: boolean;
  /** Rough estimate: cents to process one hour of meetings on this model. */
  readonly centsPerMeetingHour: number;
}

/** One provider option (the provider dropdown) + its model presets + whether a key is stored. */
export interface ProviderOption {
  readonly providerId: string;
  readonly label: string;
  /** True when an API key is stored for this provider (env fallback not counted). */
  readonly keyIsSet: boolean;
  /** True for OpenAI-compatible providers (Ollama / Custom) that need a base URL. */
  readonly needsBaseUrl: boolean;
  /** Prefill for the base-URL field (Ollama's default endpoint), else null. */
  readonly defaultBaseUrl: string | null;
  /** Preset models; may be empty (Ollama / Custom are free-text only). */
  readonly models: readonly ModelOption[];
}

export interface AiSettings {
  /** The active generation/chat provider. */
  readonly provider: string;
  /** The active generation/chat model (a preset id or a free-text id). */
  readonly model: string;
  /** The active endpoint for Ollama / Custom (empty when not applicable). */
  readonly baseUrl: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  /** Read-only: the pinned embedding model + its provider (never settable here). */
  readonly embeddingModel: string;
  readonly embeddingProvider: string;
  /** True when an OpenAI key is stored — needed for search/embeddings regardless of provider. */
  readonly openaiKeyIsSet: boolean;
  /** All selectable providers + their preset models + key status. */
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
    .in('key', [AI_PROVIDER_SETTING_KEY, AI_MODEL_SETTING_KEY, AI_BASE_URL_SETTING_KEY]);
  if (error !== null) throw new Error(`getAiSettings: ${error.message}`);

  const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
  const storedProvider = byKey.get(AI_PROVIDER_SETTING_KEY);
  const storedModel = byKey.get(AI_MODEL_SETTING_KEY);
  const storedBaseUrl = byKey.get(AI_BASE_URL_SETTING_KEY);
  const provider =
    typeof storedProvider === 'string' && isProviderId(storedProvider)
      ? storedProvider
      : DEFAULT_GENERATION_PROVIDER;
  // Model is free text (any id the provider accepts) — trust a stored non-empty value
  // as-is. Only when unset do we seed a sensible default: the global default for the
  // default provider, else that provider's first preset (empty for Ollama / Custom).
  const storedModelStr = typeof storedModel === 'string' ? storedModel : '';
  const providerModels = listModelsForProvider(provider);
  const model =
    storedModelStr !== ''
      ? storedModelStr
      : provider === DEFAULT_GENERATION_PROVIDER
        ? DEFAULT_GENERATION_MODEL
        : (providerModels[0]?.model ?? '');
  const baseUrl = typeof storedBaseUrl === 'string' ? storedBaseUrl : '';

  const integrations = await listIntegrations();
  const keyIsSet = new Map(integrations.map((i) => [i.service as string, i.isSet]));

  return {
    provider,
    model,
    baseUrl,
    defaultProvider: DEFAULT_GENERATION_PROVIDER,
    defaultModel: DEFAULT_GENERATION_MODEL,
    embeddingModel: PINNED_EMBEDDING_MODEL,
    embeddingProvider: 'openai',
    openaiKeyIsSet: keyIsSet.get('openai') ?? false,
    providers: PROVIDER_IDS.map((id) => ({
      providerId: id,
      label: PROVIDER_LABELS[id],
      keyIsSet: keyIsSet.get(id) ?? false,
      needsBaseUrl: providerNeedsBaseUrl(id),
      defaultBaseUrl: id === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : null,
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
  /** Any model id the provider accepts (a preset or free text). Required, non-empty. */
  readonly model: string;
  /** Endpoint for Ollama / Custom (OpenAI-compatible); required for those, ignored otherwise. */
  readonly baseUrl?: string;
  /** Optional new API key for the selected provider; blank/omitted keeps the stored key. */
  readonly apiKey?: string;
  /**
   * Optional OpenAI key for search/embeddings (pinned to OpenAI, D9). Used only when the
   * generation provider is NOT OpenAI — when it IS, `apiKey` already writes the OpenAI slot.
   * Blank/omitted keeps the stored key.
   */
  readonly openaiKey?: string;
  readonly updatedByUserId: string | null;
}

/**
 * Set the generation provider + model (+ base URL for Ollama/Custom), and optionally the
 * provider's API key and the OpenAI-for-embeddings key. Model is free text — any id the
 * provider accepts — so only non-emptiness is validated (a bad id fails at call time with
 * a provider error, which is unavoidable for an open model field). Admin-gated at the API
 * layer. Returns the fresh settings.
 */
export async function setAiProviderModel(params: SetAiParams): Promise<AiSettings> {
  if (!isProviderId(params.provider)) {
    throw new AiSettingsValidationError(`“${params.provider}” is not a selectable provider.`);
  }
  const model = params.model.trim();
  if (model === '') {
    throw new AiSettingsValidationError('Enter a model id (pick a preset or type one).');
  }
  const needsBaseUrl = providerNeedsBaseUrl(params.provider);
  const baseUrl = params.baseUrl?.trim() ?? '';
  if (needsBaseUrl && baseUrl === '') {
    throw new AiSettingsValidationError(`${PROVIDER_LABELS[params.provider]} needs an endpoint (base URL).`);
  }

  const db = getServerClient();
  const now = new Date().toISOString();
  // Write base URL always (empty when the provider doesn't use one) so switching away
  // from Ollama/Custom clears a stale endpoint.
  const { error } = await db.from('settings').upsert(
    [
      { key: AI_PROVIDER_SETTING_KEY, value: params.provider, updated_by_user_id: params.updatedByUserId, updated_at: now },
      { key: AI_MODEL_SETTING_KEY, value: model, updated_by_user_id: params.updatedByUserId, updated_at: now },
      { key: AI_BASE_URL_SETTING_KEY, value: needsBaseUrl ? baseUrl : '', updated_by_user_id: params.updatedByUserId, updated_at: now },
    ],
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setAiProviderModel: ${error.message}`);

  // Selected provider's key (ProviderId ⊆ IntegrationKey — one encrypted slot per provider).
  const key = params.apiKey?.trim();
  if (key !== undefined && key !== '') {
    await setIntegration(params.provider, { secret: key, updatedByUserId: params.updatedByUserId });
  }

  // OpenAI-for-embeddings key: only when generation is on another provider (otherwise the
  // key above already wrote the OpenAI slot — no confusing duplicate).
  const openaiKey = params.openaiKey?.trim();
  if (openaiKey !== undefined && openaiKey !== '' && params.provider !== 'openai') {
    await setIntegration('openai', { secret: openaiKey, updatedByUserId: params.updatedByUserId });
  }

  return getAiSettings();
}
