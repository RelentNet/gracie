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
 * AI provider ids the platform can construct + select (Settings → AI). Every
 * text-generation provider the Vercel AI SDK ships an adapter for, plus two
 * OpenAI-compatible catch-alls: `ollama` (local, runs-on-your-own-hardware) and
 * `custom` (any OpenAI-compatible endpoint — OpenRouter/LiteLLM/vLLM/Together/…).
 * Adding another is: an id here, a label + key slot, a `createProvider` switch case,
 * and (optionally) a catalog block. OpenAI stays the default so a fresh deploy is
 * unchanged. NOTE: speech/transcription-only providers (elevenlabs/deepgram/…) are
 * intentionally excluded — this seam is text generation + chat only.
 */
export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'groq',
  'deepseek',
  'xai',
  'cohere',
  'perplexity',
  'ollama',
  'custom',
] as const;

/** A provider the admin may select. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Human label per provider (the provider dropdown in Settings → AI). */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  mistral: 'Mistral',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  xai: 'xAI (Grok)',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  ollama: 'Ollama (local)',
  custom: 'Custom (OpenAI-compatible)',
};

/**
 * Providers reached over the OpenAI-compatible HTTP shape (@ai-sdk/openai-compatible)
 * rather than a bespoke SDK. They REQUIRE a base URL (their endpoint) and take any
 * model id as free text; Ollama's key is optional, Custom's is usually required.
 */
export const OPENAI_COMPATIBLE_PROVIDERS: readonly ProviderId[] = ['ollama', 'custom'];

/** Default Ollama endpoint (OpenAI-compatible path). Prefilled in Settings. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/** True for a provider that needs a base URL (Ollama / Custom OpenAI-compatible). */
export function providerNeedsBaseUrl(providerId: string): boolean {
  return (OPENAI_COMPATIBLE_PROVIDERS as readonly string[]).includes(providerId);
}

/** True when `value` is a selectable provider id. */
export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * One selectable generation/chat model with its capabilities + rough list pricing.
 * The catalog is a set of PRESETS per provider — a convenient starting menu, NOT an
 * allowlist: Settings also offers a "Custom model…" free-text field so any current or
 * future model id the provider accepts can be typed (the AI SDK passes the id straight
 * through). A free-text id has unknown cost, so Settings shows "cost varies" rather
 * than a wrong number. Prices below are public list prices (USD per 1M tokens) as of
 * 2026-08, used ONLY for the in-Settings cost estimate — not billing. Ollama + Custom
 * have NO presets on purpose (self-hosted / arbitrary endpoints — model ids and costs
 * are unknowable here); they are free-text only.
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
  // Google (Gemini)
  { providerId: 'google', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', supportsTools: true, supportsJson: true, costPer1MInput: 1.25, costPer1MOutput: 10 },
  { providerId: 'google', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', supportsTools: true, supportsJson: true, costPer1MInput: 0.3, costPer1MOutput: 2.5 },
  { providerId: 'google', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', supportsTools: true, supportsJson: true, costPer1MInput: 0.1, costPer1MOutput: 0.4 },
  // Mistral
  { providerId: 'mistral', model: 'mistral-large-latest', label: 'Mistral Large', supportsTools: true, supportsJson: true, costPer1MInput: 2, costPer1MOutput: 6 },
  { providerId: 'mistral', model: 'mistral-small-latest', label: 'Mistral Small', supportsTools: true, supportsJson: true, costPer1MInput: 0.2, costPer1MOutput: 0.6 },
  // Groq (hosted open models — very cheap, very fast)
  { providerId: 'groq', model: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', supportsTools: true, supportsJson: true, costPer1MInput: 0.59, costPer1MOutput: 0.79 },
  { providerId: 'groq', model: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Groq)', supportsTools: true, supportsJson: true, costPer1MInput: 0.05, costPer1MOutput: 0.08 },
  // DeepSeek
  { providerId: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Chat', supportsTools: true, supportsJson: true, costPer1MInput: 0.27, costPer1MOutput: 1.1 },
  { providerId: 'deepseek', model: 'deepseek-reasoner', label: 'DeepSeek Reasoner', supportsTools: true, supportsJson: true, costPer1MInput: 0.55, costPer1MOutput: 2.19 },
  // xAI (Grok)
  { providerId: 'xai', model: 'grok-3', label: 'Grok 3', supportsTools: true, supportsJson: true, costPer1MInput: 3, costPer1MOutput: 15 },
  { providerId: 'xai', model: 'grok-3-mini', label: 'Grok 3 Mini', supportsTools: true, supportsJson: true, costPer1MInput: 0.3, costPer1MOutput: 0.5 },
  // Cohere
  { providerId: 'cohere', model: 'command-r-plus', label: 'Command R+', supportsTools: true, supportsJson: true, costPer1MInput: 2.5, costPer1MOutput: 10 },
  { providerId: 'cohere', model: 'command-r', label: 'Command R', supportsTools: true, supportsJson: true, costPer1MInput: 0.15, costPer1MOutput: 0.6 },
  // Perplexity (Sonar — web-grounded)
  { providerId: 'perplexity', model: 'sonar', label: 'Sonar', supportsTools: false, supportsJson: true, costPer1MInput: 1, costPer1MOutput: 1 },
  { providerId: 'perplexity', model: 'sonar-pro', label: 'Sonar Pro', supportsTools: false, supportsJson: true, costPer1MInput: 3, costPer1MOutput: 15 },
  // Ollama + Custom have NO presets — free-text model id only (see catalog note above).
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
