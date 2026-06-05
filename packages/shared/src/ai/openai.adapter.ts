/**
 * OpenAI adapter — STUB (Phase 1A).
 *
 * Interface-only. No SDK import, no network calls. Every method throws so that
 * any accidental call site fails loudly during scaffold development.
 *
 * Phase 1B TODO: implement against the OpenAI SDK behind this contract. Read the
 * API key via getCredential('openai') (docs/07 credential resolution); never
 * import the key directly here. Embeddings must use PINNED_EMBEDDING_MODEL (D9).
 */
import type {
  AIProvider,
  EmbedInput,
  GenerateInput,
  GenerateResult,
} from './provider.js';

const NOT_IMPLEMENTED = 'OpenAI adapter is not implemented in Phase 1A (interface only).';

export class OpenAIAdapter implements AIProvider {
  public readonly id = 'openai';

  public async generate(_input: GenerateInput): Promise<GenerateResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  // eslint-disable-next-line require-yield -- stub: throws before yielding
  public async *stream(_input: GenerateInput): AsyncIterable<string> {
    throw new Error(NOT_IMPLEMENTED);
  }

  public async embed(_input: EmbedInput): Promise<number[][]> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
