/**
 * Vercel AI SDK adapter — implements the AIProvider contract (docs/06 §1, D11) over
 * the `ai` package so the generation provider is swappable (OpenAI default,
 * Anthropic, …) with zero call-site changes. This REPLACES the bespoke fetch-based
 * OpenAIAdapter as the impl `createProvider` returns.
 *
 * The API key is INJECTED via the constructor; which provider/model is active + key
 * resolution lives server-side (packages/db `getActiveProvider`/`getEmbedder`), so
 * this stays a pure adapter with no DB/settings dependency.
 *
 * Embeddings are PINNED to OpenAI text-embedding-3-small (1536-dim, D9): the registry
 * resolves the embedder as an OpenAI provider regardless of the selected generation
 * provider, so switching generation to Anthropic never changes stored vectors. The
 * embed() method therefore only works on the OpenAI adapter; on any other provider it
 * throws (it is never reached in practice — getEmbedder always builds an OpenAI one).
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createXai } from '@ai-sdk/xai';
import {
  embedMany,
  generateObject,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type EmbeddingModel,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from 'ai';

import {
  PINNED_EMBEDDING_MODEL,
  providerNeedsBaseUrl,
  type AIMessage,
  type AIProvider,
  type AITool,
  type AIToolCall,
  type EmbedInput,
  type GenerateInput,
  type GenerateResult,
  type ProviderId,
} from './provider.js';

export interface VercelAIAdapterConfig {
  readonly apiKey: string;
  /** Optional base-URL override (Azure OpenAI / a compatible proxy). */
  readonly baseUrl?: string;
}

/** SDK tool-call shape we map back from (generateText result). */
interface SdkToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

/** Parse a raw tool-args JSON string to the object the SDK re-serializes; {} on garbage. */
function parseArgs(raw: string): unknown {
  try {
    return raw === '' ? {} : JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Map the neutral message list to AI SDK `ModelMessage[]`. Plain turns map 1:1; an
 * `assistant` turn with `toolCalls` and a `tool` result turn expand to the SDK's
 * content-part protocol. Tool results need the tool NAME (the SDK requires it), which
 * the neutral `tool` message omits — recover it from the matching tool-call id.
 */
export function toModelMessages(messages: readonly AIMessage[]): ModelMessage[] {
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls !== undefined) {
      for (const tc of m.toolCalls) toolNameById.set(tc.id, tc.name);
    }
  }

  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const id = m.toolCallId ?? '';
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: id,
            toolName: toolNameById.get(id) ?? '',
            output: { type: 'text', value: m.content },
          },
        ],
      });
    } else if (m.role === 'assistant' && m.toolCalls !== undefined && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content === '' ? [] : [{ type: 'text' as const, text: m.content }]),
          ...m.toolCalls.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: parseArgs(tc.arguments),
          })),
        ],
      });
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content });
    } else {
      out.push({ role: 'user', content: m.content });
    }
  }
  return out;
}

/** Map advertised tools (JSON-Schema params) to an AI SDK ToolSet; undefined when none. */
export function toToolSet(tools: readonly AITool[] | undefined): ToolSet | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  const set: ToolSet = {};
  for (const t of tools) {
    // No `execute`: the model returns the call and stops — the caller's buffered loop
    // runs it and re-generates (matches the pre-SDK OpenAIAdapter behavior).
    set[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]),
    });
  }
  return set;
}

/** Map SDK tool calls back to the neutral shape (RAW args as a JSON string). */
export function toAIToolCalls(calls: readonly SdkToolCall[]): AIToolCall[] {
  return calls.map((c) => ({
    id: c.toolCallId,
    name: c.toolName,
    arguments: JSON.stringify(c.input ?? {}),
  }));
}

/** Map SDK usage ({inputTokens, outputTokens}) to the neutral {promptTokens, completionTokens}. */
export function toUsage(usage: LanguageModelUsage): { promptTokens: number; completionTokens: number } {
  return { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 };
}

/** Build the provider-specific language-model factory + (OpenAI-only) embedder. */
function build(providerId: ProviderId, config: VercelAIAdapterConfig): {
  languageModel: (modelId: string) => LanguageModel;
  embeddingModel: EmbeddingModel | null;
} {
  // Non-OpenAI providers have no embeddings here; embeddings stay pinned to OpenAI (D9),
  // so their embeddingModel is null and getEmbedder() always builds an OpenAI adapter.
  switch (providerId) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
      // `.chat()` uses Chat Completions (json_object mode + tool_calls) — matches the
      // pre-SDK OpenAIAdapter exactly.
      return { languageModel: (m): LanguageModel => openai.chat(m), embeddingModel: openai.embedding(PINNED_EMBEDDING_MODEL) };
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => anthropic(m), embeddingModel: null };
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => google(m), embeddingModel: null };
    }
    case 'mistral': {
      const mistral = createMistral({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => mistral(m), embeddingModel: null };
    }
    case 'groq': {
      const groq = createGroq({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => groq(m), embeddingModel: null };
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => deepseek(m), embeddingModel: null };
    }
    case 'xai': {
      const xai = createXai({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => xai(m), embeddingModel: null };
    }
    case 'cohere': {
      const cohere = createCohere({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => cohere(m), embeddingModel: null };
    }
    case 'perplexity': {
      const perplexity = createPerplexity({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return { languageModel: (m): LanguageModel => perplexity(m), embeddingModel: null };
    }
    case 'ollama':
    case 'custom': {
      // Catch-all OpenAI-compatible path (Ollama local, OpenRouter/LiteLLM/vLLM/LM Studio/
      // Together/Fireworks/…). `baseURL` is REQUIRED (validated in the constructor); the
      // key is optional for Ollama, so pass undefined when blank. `name` is required by
      // the SDK — use the provider id.
      const compatible = createOpenAICompatible({
        name: providerId,
        baseURL: config.baseUrl ?? '',
        apiKey: config.apiKey === '' ? undefined : config.apiKey,
      });
      return { languageModel: (m): LanguageModel => compatible(m), embeddingModel: null };
    }
    default:
      throw new Error(`Unknown AI provider: ${String(providerId)}`);
  }
}

export class VercelAIAdapter implements AIProvider {
  public readonly id: ProviderId;
  private readonly languageModel: (modelId: string) => LanguageModel;
  private readonly embeddingModel: EmbeddingModel | null;

  public constructor(providerId: ProviderId, config: VercelAIAdapterConfig) {
    // OpenAI-compatible providers (Ollama / Custom) authenticate to an endpoint, so they
    // REQUIRE a base URL; the key is optional (Ollama runs keyless). Every other provider
    // is keyed against a fixed endpoint, so it requires a non-empty key.
    if (providerNeedsBaseUrl(providerId)) {
      if (config.baseUrl === undefined || config.baseUrl === '') {
        throw new Error(`The ${providerId} provider requires a base URL (its endpoint).`);
      }
    } else if (config.apiKey === '') {
      throw new Error('VercelAIAdapter requires a non-empty apiKey.');
    }
    this.id = providerId;
    const built = build(providerId, config);
    this.languageModel = built.languageModel;
    this.embeddingModel = built.embeddingModel;
  }

  public async generate(input: GenerateInput): Promise<GenerateResult> {
    const model = this.languageModel(input.model);
    const messages = toModelMessages(input.messages);

    // JSON mode (task/doc extraction): no-schema object generation ≈ OpenAI json_object.
    if (input.responseFormat === 'json') {
      const res = await generateObject({
        model,
        system: input.system,
        messages,
        output: 'no-schema',
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      });
      return {
        content: JSON.stringify(res.object),
        providerId: this.id,
        model: input.model,
        finishReason: res.finishReason,
        usage: toUsage(res.usage),
      };
    }

    const tools = toToolSet(input.tools);
    const res = await generateText({
      model,
      system: input.system,
      messages,
      ...(tools !== undefined ? { tools, toolChoice: input.toolChoice ?? 'auto' } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    });
    const toolCalls = toAIToolCalls(res.toolCalls);
    return {
      content: res.text,
      providerId: this.id,
      model: input.model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      finishReason: res.finishReason,
      usage: toUsage(res.usage),
    };
  }

  public async *stream(input: GenerateInput): AsyncIterable<string> {
    // `textStream` swallows error parts (they surface via onError), so capture and
    // rethrow after draining — the assistant route wraps this in try/catch.
    let streamError: unknown = null;
    const res = streamText({
      model: this.languageModel(input.model),
      system: input.system,
      messages: toModelMessages(input.messages),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      onError: ({ error }): void => {
        streamError = error;
      },
    });
    for await (const delta of res.textStream) {
      if (delta !== '') yield delta;
    }
    if (streamError !== null) {
      throw streamError instanceof Error ? streamError : new Error(String(streamError));
    }
  }

  public async embed(input: EmbedInput): Promise<number[][]> {
    if (this.embeddingModel === null) {
      throw new Error(
        `Embeddings are pinned to OpenAI (${PINNED_EMBEDDING_MODEL}); the ${this.id} adapter cannot embed. Use getEmbedder().`,
      );
    }
    const { embeddings } = await embedMany({ model: this.embeddingModel, values: [...input.input] });
    return embeddings;
  }
}
