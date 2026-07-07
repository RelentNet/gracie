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

/**
 * A tool/function the model MAY call (OpenAI function-calling shape). `parameters`
 * is a JSON Schema object describing the (typed) arguments. Advertised via
 * `GenerateInput.tools`; the model answers with `GenerateResult.toolCalls`.
 */
export interface AITool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments object. */
  readonly parameters: Record<string, unknown>;
}

/**
 * One tool invocation the model requested. `arguments` is the RAW JSON string the
 * model emitted (parse + validate at the call site — never trust it structurally).
 */
export interface AIToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/**
 * Conversation message in a generation request.
 *
 * Roles: `user`/`assistant` are the normal turns. Tool-calling adds two additive,
 * OPTIONAL shapes used only by the agentic loop (existing callers are unaffected):
 *  - an `assistant` message carrying `toolCalls` (the model asked to call tools);
 *  - a `tool` message carrying the result for one call (`toolCallId` + `content`).
 */
export interface AIMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Present on an `assistant` message that requested tool calls. */
  readonly toolCalls?: readonly AIToolCall[];
  /** Present on a `tool` message — the id of the call this result answers. */
  readonly toolCallId?: string;
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
  /** Tools the model may call this turn (function-calling). Omit for a plain turn. */
  readonly tools?: readonly AITool[];
  /**
   * Tool-selection policy when `tools` is set: `auto` (default — model decides),
   * `none` (force a text answer), `required` (force at least one tool call).
   */
  readonly toolChoice?: 'auto' | 'none' | 'required';
}

export interface GenerateResult {
  /** Generated text (or JSON string when responseFormat === 'json'). */
  readonly content: string;
  /** Provider id that produced the result. */
  readonly providerId: string;
  /** Model id that produced the result. */
  readonly model: string;
  /** Tool calls the model requested this turn (empty/absent = it answered). */
  readonly toolCalls?: readonly AIToolCall[];
  /** Why generation stopped (e.g. 'stop', 'tool_calls', 'length'). */
  readonly finishReason?: string;
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
