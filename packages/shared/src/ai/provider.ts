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

/**
 * AI provider ids the platform can construct + select (Settings → AI). OpenAI +
 * Anthropic today; the factory + catalog are left trivially extensible for
 * google/ollama (PR 2) — add an id here, a catalog block below, and a case in the
 * adapter's switch.
 */
export const PROVIDER_IDS = ['openai', 'anthropic'] as const;

/** A provider the admin may select. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Human label per provider (the "Company"/provider dropdown in Settings → AI). */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

/** True when `value` is a selectable provider id. */
export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * One selectable generation/chat model with its capabilities + rough list pricing.
 * The catalog is curated on purpose — free-texting a model id would let a typo (or a
 * model this account can't use) fail silently at call time. Prices are public list
 * prices (USD per 1M tokens) as of 2026-08, used ONLY for the in-Settings cost
 * estimate — not billing. Calibrate against real spend in PR 2.
 */
export interface ModelCatalogEntry {
  readonly providerId: ProviderId;
  readonly model: string;
  readonly label: string;
  readonly supportsTools: boolean;
  readonly supportsJson: boolean;
  readonly costPer1MInput: number;
  readonly costPer1MOutput: number;
}

/** All admin-selectable generation models, grouped by provider. */
export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  // OpenAI (default provider)
  { providerId: 'openai', model: 'gpt-4o', label: 'GPT-4o', supportsTools: true, supportsJson: true, costPer1MInput: 2.5, costPer1MOutput: 10 },
  { providerId: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini', supportsTools: true, supportsJson: true, costPer1MInput: 0.15, costPer1MOutput: 0.6 },
  { providerId: 'openai', model: 'gpt-4.1', label: 'GPT-4.1', supportsTools: true, supportsJson: true, costPer1MInput: 2, costPer1MOutput: 8 },
  { providerId: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 mini', supportsTools: true, supportsJson: true, costPer1MInput: 0.4, costPer1MOutput: 1.6 },
  // Anthropic (Claude) — prices approximate
  { providerId: 'anthropic', model: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', supportsTools: true, supportsJson: true, costPer1MInput: 3, costPer1MOutput: 15 },
  { providerId: 'anthropic', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', supportsTools: true, supportsJson: true, costPer1MInput: 1, costPer1MOutput: 5 },
  { providerId: 'anthropic', model: 'claude-opus-4-5', label: 'Claude Opus 4.5', supportsTools: true, supportsJson: true, costPer1MInput: 5, costPer1MOutput: 25 },
];

/** Default provider when `settings.ai_provider` is unset — OpenAI, so a fresh deploy is unchanged. */
export const DEFAULT_GENERATION_PROVIDER: ProviderId = 'openai';

/** Default generation model when `settings.ai_model` is unset (single source of truth). */
export const DEFAULT_GENERATION_MODEL = 'gpt-4o';

/** Catalog entries for one provider (populates the model dropdown). */
export function listModelsForProvider(providerId: string): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((m) => m.providerId === providerId);
}

/** The catalog entry for a (provider, model) pair, or undefined if not a valid pair. */
export function findModel(providerId: string, model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.providerId === providerId && m.model === model);
}

/**
 * Rough planning constants: tokens to process ONE hour of meeting (transcript in +
 * generated notes/tasks out). Ballpark — a real hour varies wildly with transcript
 * length; calibrate against measured spend in PR 2.
 */
export const AVG_INPUT_TOKENS_PER_MEETING_HOUR = 12_000;
export const AVG_OUTPUT_TOKENS_PER_MEETING_HOUR = 3_000;

/** Estimated cents to process one hour of meetings on a model (from list prices). */
export function estimateCentsPerMeetingHour(entry: ModelCatalogEntry): number {
  const usd =
    (AVG_INPUT_TOKENS_PER_MEETING_HOUR / 1_000_000) * entry.costPer1MInput +
    (AVG_OUTPUT_TOKENS_PER_MEETING_HOUR / 1_000_000) * entry.costPer1MOutput;
  return usd * 100;
}
