/**
 * Provider registry — STUB (Phase 1A).
 *
 * Selects a generation provider from settings and always routes embeddings to
 * the pinned model (D9). Wiring shape mirrors docs/06 §1.
 *
 * Phase 1B TODO:
 *   - getProvider(): read settings.ai_provider + ai_model, load the matching
 *     adapter, inject the decrypted key via getCredential(service) (docs/07).
 *   - getEmbedder(): always OpenAI text-embedding-3-small (PINNED_EMBEDDING_MODEL).
 *   - On missing/invalid key: fail loudly; pipeline marks run `needs_attention`.
 */
import { OpenAIAdapter } from './openai.adapter.js';
import { PINNED_EMBEDDING_MODEL } from './provider.js';
import type { AIProvider } from './provider.js';

/** Known provider ids the registry can construct. */
export type ProviderId = 'openai' | 'anthropic';

/** Factory map. Phase 1A registers OpenAI only; Anthropic lands later. */
const ADAPTERS: Readonly<Record<ProviderId, () => AIProvider>> = {
  openai: () => new OpenAIAdapter(),
  // Phase 1B+: anthropic: () => new AnthropicAdapter(),
  anthropic: () => {
    throw new Error('Anthropic adapter is not implemented in Phase 1A.');
  },
};

/**
 * Resolve the generation provider selected in Settings.
 *
 * Phase 1A: constructs the adapter but does NOT read settings or inject keys —
 * those land in Phase 1B. Defaults to OpenAI.
 */
export function getProvider(providerId: ProviderId = 'openai'): AIProvider {
  const factory = ADAPTERS[providerId];
  if (factory === undefined) {
    throw new Error(`Unknown AI provider: ${providerId}`);
  }
  return factory();
}

/**
 * Resolve the embedder. PINNED to OpenAI text-embedding-3-small (D9) regardless
 * of the selected generation provider, to keep the pgvector index coherent.
 */
export function getEmbedder(): { provider: AIProvider; model: string } {
  return { provider: new OpenAIAdapter(), model: PINNED_EMBEDDING_MODEL };
}
