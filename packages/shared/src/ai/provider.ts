/**
 * ⭐ Universal AI provider interface (D11) — the most important contract.
 *
 * RULE: No code anywhere calls an AI SDK directly. Everything routes through
 * this interface. Adding a provider later (e.g. Anthropic) = a new adapter
 * against this contract + a key in Admin → API Settings. Zero call-site changes.
 *
 * Shape mirrors docs/06 §1 and docs/03 §5.
 *   - generate / stream → provider + model are switchable (Settings).
 *   - embed             → registry ALWAYS routes to the pinned embedding model
 *                         `text-embedding-3-small` (1536-dim) regardless of the
 *                         selected generation provider (D9).
 */

/** Conversation message in a generation request. */
export interface AIMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface GenerateInput {
  /** Model id selected in Settings (e.g. 'gpt-4o'). */
  readonly model: string;
  /** Assembled 5-layer prompt — the system portion (docs/06 §2). */
  readonly system: string;
  readonly messages: readonly AIMessage[];
  readonly temperature?: number;
  /** Task extraction uses 'json' to force structured output (docs/06 §6). */
  readonly responseFormat?: 'text' | 'json';
}

export interface GenerateResult {
  /** Generated text (or JSON string when responseFormat === 'json'). */
  readonly content: string;
  /** Provider id that produced the result. */
  readonly providerId: string;
  /** Model id that produced the result. */
  readonly model: string;
  /** Token accounting when the provider reports it. */
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
}

export interface EmbedInput {
  /** One or more texts to embed. */
  readonly input: readonly string[];
  /**
   * Pinned per D9. Optional override exists only for adapter symmetry; the
   * registry's embedder ignores any non-pinned value to keep the index coherent.
   */
  readonly model?: string;
}

/**
 * The contract every provider adapter implements.
 *
 * `embed` returns one 1536-length vector per input string (pinned model, D9).
 */
export interface AIProvider {
  readonly id: string; // 'openai' | 'anthropic' | ...
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<string>;
  embed(input: EmbedInput): Promise<number[][]>;
}

/** Embedding model pinned for index coherence (D9). */
export const PINNED_EMBEDDING_MODEL = 'text-embedding-3-small' as const;

/** Dimensionality of the pinned embedding model (matches pgvector schema). */
export const EMBEDDING_DIMENSIONS = 1536 as const;
