/**
 * Server-side AI provider resolution (docs/06 §1, D11). Bridges the runtime
 * credential store (getCredential) + `settings` to the pure provider factory in
 * @gracie/shared. This is the single place the pipeline/chat obtain a provider,
 * so generation provider/model are swappable from Admin → API Settings with no
 * call-site changes. Embeddings stay pinned (D9).
 */
import { createProvider, DEFAULT_GENERATION_MODEL, PINNED_EMBEDDING_MODEL, type AIProvider } from '@gracie/shared';

import { getServerClient } from './client.js';
import { getCredential } from './credentials.js';

async function getSettingString(key: string): Promise<string | null> {
  const db = getServerClient();
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`getSetting(${key}): ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
}

async function requireOpenAIKey(): Promise<string> {
  const apiKey = await getCredential('openai');
  if (apiKey === null || apiKey === '') {
    throw new Error('No OpenAI API key configured. Set it in Admin → API Settings.');
  }
  return apiKey;
}

/**
 * Resolve the active generation provider + model. Provider is OpenAI for now
 * (D11 — OpenAI first); `settings.ai_provider` will switch it once more adapters
 * land. The key comes from the credential store (stored → env fallback).
 */
export async function getActiveProvider(): Promise<{ provider: AIProvider; model: string }> {
  const apiKey = await requireOpenAIKey();
  const provider = createProvider('openai', { apiKey });
  const model = (await getSettingString('ai_model')) ?? DEFAULT_GENERATION_MODEL;
  return { provider, model };
}

/** Resolve the embedder — PINNED to OpenAI text-embedding-3-small (D9). */
export async function getEmbedder(): Promise<{ provider: AIProvider; model: string }> {
  const apiKey = await requireOpenAIKey();
  return { provider: createProvider('openai', { apiKey }), model: PINNED_EMBEDDING_MODEL };
}
