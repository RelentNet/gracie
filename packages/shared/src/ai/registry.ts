/**
 * Provider factory (docs/06 §1, D11). Pure: given a provider id + resolved
 * config (api key), constructs the matching adapter. The "which provider/model
 * is active" + key resolution lives server-side (packages/db `getActiveProvider`
 * / `getEmbedder`), so this module has no DB/settings dependency.
 */
import { OpenAIAdapter } from './openai.adapter.js';
import type { AIProvider } from './provider.js';

/** Provider ids the factory can construct. */
export type ProviderId = 'openai' | 'anthropic';

export interface ProviderConfig {
  readonly apiKey: string;
  /** Optional base-URL override (Azure OpenAI / proxy). */
  readonly baseUrl?: string;
}

/** Construct a provider adapter for the given id + config. */
export function createProvider(providerId: ProviderId, config: ProviderConfig): AIProvider {
  switch (providerId) {
    case 'openai':
      return new OpenAIAdapter(config);
    case 'anthropic':
      throw new Error('Anthropic adapter is not implemented yet (add an adapter against AIProvider).');
    default:
      throw new Error(`Unknown AI provider: ${String(providerId)}`);
  }
}
