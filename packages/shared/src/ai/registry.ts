/**
 * Provider factory (docs/06 §1, D11). Pure: given a provider id + resolved config
 * (api key), constructs the matching adapter over the Vercel AI SDK. The "which
 * provider/model is active" + key resolution lives server-side (packages/db
 * `getActiveProvider` / `getEmbedder`), so this module has no DB/settings dependency.
 *
 * One adapter (`VercelAIAdapter`) backs every provider; adding google/ollama later is
 * a new case in the adapter's switch + a catalog block — no change here.
 */
import type { AIProvider, ProviderId } from './provider.js';
import { VercelAIAdapter } from './vercel.adapter.js';

export interface ProviderConfig {
  readonly apiKey: string;
  /** Optional base-URL override (Azure OpenAI / proxy). */
  readonly baseUrl?: string;
}

/** Construct a provider adapter for the given id + config. */
export function createProvider(providerId: ProviderId, config: ProviderConfig): AIProvider {
  return new VercelAIAdapter(providerId, config);
}
