/**
 * Server-side AI provider resolution (docs/06 §1, D11). Bridges the runtime
 * credential store (getCredential) + `settings` to the pure provider factory in
 * @gracie/shared. This is the single place the pipeline/chat obtain a provider,
 * so generation provider/model are swappable from Admin → API Settings with no
 * call-site changes. Embeddings stay pinned (D9).
 */
import {
  createProvider,
  DEFAULT_GENERATION_MODEL,
  DEFAULT_GENERATION_PROVIDER,
  isProviderId,
  OPENROUTER_EMBEDDING_MODEL,
  PINNED_EMBEDDING_MODEL,
  providerNeedsBaseUrl,
  type AIProvider,
  type ProviderId,
} from '@gracie/shared';

import { getServerClient } from './client.js';
import { getCredential } from './credentials.js';

async function getSettingString(key: string): Promise<string | null> {
  const db = getServerClient();
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`getSetting(${key}): ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
}

/** Resolve a provider's key from the credential store (stored → env fallback). */
async function requireProviderKey(providerId: ProviderId): Promise<string> {
  const apiKey = await getCredential(providerId);
  if (apiKey === null || apiKey === '') {
    throw new Error(`No ${providerId} API key configured. Set it in Settings → AI.`);
  }
  return apiKey;
}

/** The active generation provider id (`settings.ai_provider`), defaulting to OpenAI (D11). */
async function getActiveProviderId(): Promise<ProviderId> {
  const stored = await getSettingString('ai_provider');
  return stored !== null && isProviderId(stored) ? stored : DEFAULT_GENERATION_PROVIDER;
}

/**
 * Resolve the active generation provider + model from Settings → AI. An admin picks
 * the provider (`ai_provider`) + model (`ai_model`, free text or a preset) and enters
 * that provider's key; the pair is validated on save, so this trusts the stored values.
 * Defaults to OpenAI + gpt-4o so a fresh deploy behaves identically until switched.
 *
 * OpenAI-compatible providers (Ollama / Custom) resolve a base URL from `ai_base_url`
 * and pass it to the adapter; their key is OPTIONAL (Ollama runs keyless), so a missing
 * key is not an error for them — a missing base URL is.
 */
export async function getActiveProvider(): Promise<{ provider: AIProvider; model: string }> {
  const providerId = await getActiveProviderId();
  const model = (await getSettingString('ai_model')) ?? DEFAULT_GENERATION_MODEL;

  if (providerNeedsBaseUrl(providerId)) {
    const baseUrl = await getSettingString('ai_base_url');
    if (baseUrl === null || baseUrl === '') {
      throw new Error(`No endpoint (base URL) configured for ${providerId}. Set it in Settings → AI.`);
    }
    const apiKey = (await getCredential(providerId)) ?? ''; // optional (Ollama runs keyless)
    return { provider: createProvider(providerId, { apiKey, baseUrl }), model };
  }

  const apiKey = await requireProviderKey(providerId);
  return { provider: createProvider(providerId, { apiKey }), model };
}

/**
 * Resolve the embedder — ALWAYS text-embedding-3-small (1536-dim, D9), regardless
 * of the selected generation provider, so switching generation never changes
 * stored vectors.
 *
 * Two routes reach that one model: OpenAI directly, or OpenRouter (which serves it
 * as `openai/text-embedding-3-small`). Same model => same vector space, so either
 * may embed and every stored vector stays comparable. An OpenAI key wins when both
 * are present, which keeps existing deployments on exactly the path they use today.
 */
export async function getEmbedder(): Promise<{ provider: AIProvider; model: string }> {
  const openaiKey = await getCredential('openai');
  if (openaiKey !== null && openaiKey !== '') {
    return { provider: createProvider('openai', { apiKey: openaiKey }), model: PINNED_EMBEDDING_MODEL };
  }
  const openrouterKey = await getCredential('openrouter');
  if (openrouterKey !== null && openrouterKey !== '') {
    return {
      provider: createProvider('openrouter', { apiKey: openrouterKey }),
      model: OPENROUTER_EMBEDDING_MODEL,
    };
  }
  throw new Error('No embeddings key configured. Set an OpenAI or OpenRouter key in Settings → AI.');
}
