/**
 * OpenAI adapter — implements the AIProvider contract (docs/06 §1) over the
 * OpenAI REST API with `fetch` (no SDK dependency). The API key is INJECTED via
 * the constructor; resolution from the credential store / env lives server-side
 * (packages/db `getActiveProvider`/`getEmbedder`), so this stays a pure adapter.
 *
 * `baseUrl` is overridable for Azure OpenAI / a proxy (resale flexibility).
 */
import {
  PINNED_EMBEDDING_MODEL,
  type AIProvider,
  type AIToolCall,
  type EmbedInput,
  type GenerateInput,
  type GenerateResult,
} from './provider.js';

export interface OpenAIAdapterConfig {
  readonly apiKey: string;
  /** Defaults to OpenAI. Override for Azure OpenAI / a compatible proxy. */
  readonly baseUrl?: string;
}

interface ApiToolCall {
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface ChatCompletionResponse {
  readonly choices: ReadonlyArray<{
    readonly message?: { readonly content?: string | null; readonly tool_calls?: readonly ApiToolCall[] };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

/** Map raw OpenAI `tool_calls` to the provider-neutral shape; drop malformed entries. */
function toToolCalls(raw: readonly ApiToolCall[] | undefined): AIToolCall[] {
  return (raw ?? [])
    .filter((c): c is ApiToolCall => typeof c.function?.name === 'string' && c.function.name !== '')
    .map((c) => ({
      id: c.id ?? '',
      name: c.function?.name ?? '',
      arguments: c.function?.arguments ?? '',
    }));
}

interface EmbeddingResponse {
  readonly data: ReadonlyArray<{ readonly embedding: number[] }>;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIAdapter implements AIProvider {
  public readonly id = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  public constructor(config: OpenAIAdapterConfig) {
    if (config.apiKey === '') {
      throw new Error('OpenAIAdapter requires a non-empty apiKey.');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /**
   * Serialize the neutral message list to OpenAI wire shape. Plain turns map 1:1;
   * an `assistant` turn with `toolCalls` and a `tool` result turn are expanded to
   * the function-calling protocol (assistant `content: null` + `tool_calls`, then
   * one `{ role: 'tool', tool_call_id }` per result).
   */
  private toApiMessages(input: GenerateInput): unknown[] {
    const out: unknown[] = [{ role: 'system', content: input.system }];
    for (const m of input.messages) {
      if (m.role === 'tool') {
        out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
      } else if (m.role === 'assistant' && m.toolCalls !== undefined && m.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: m.content === '' ? null : m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else {
        out.push({ role: m.role, content: m.content });
      }
    }
    return out;
  }

  private chatBody(input: GenerateInput, stream: boolean): string {
    const payload: Record<string, unknown> = {
      model: input.model,
      stream,
      messages: this.toApiMessages(input),
    };
    if (input.temperature !== undefined) payload.temperature = input.temperature;
    if (input.responseFormat === 'json') payload.response_format = { type: 'json_object' };
    if (input.tools !== undefined && input.tools.length > 0) {
      payload.tools = input.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      payload.tool_choice = input.toolChoice ?? 'auto';
    }
    return JSON.stringify(payload);
  }

  public async generate(input: GenerateInput): Promise<GenerateResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.chatBody(input, false),
    });
    if (!res.ok) {
      throw new Error(`OpenAI generate failed (HTTP ${res.status}): ${await safeText(res)}`);
    }
    const json = (await res.json()) as ChatCompletionResponse;
    const choice = json.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls = toToolCalls(choice?.message?.tool_calls);
    const finishReason = choice?.finish_reason ?? undefined;
    const usage =
      json.usage !== undefined
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : undefined;
    return {
      content,
      providerId: this.id,
      model: input.model,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(finishReason !== undefined && finishReason !== null ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  public async *stream(input: GenerateInput): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.chatBody(input, true),
    });
    if (!res.ok) {
      throw new Error(`OpenAI stream failed (HTTP ${res.status}): ${await safeText(res)}`);
    }
    if (res.body === null) {
      throw new Error('OpenAI stream returned no response body.');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '' || data === '[DONE]') continue;
        const token = deltaContent(data);
        if (token !== '') yield token;
      }
    }
  }

  public async embed(input: EmbedInput): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: input.model ?? PINNED_EMBEDDING_MODEL, input: input.input }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embed failed (HTTP ${res.status}): ${await safeText(res)}`);
    }
    const json = (await res.json()) as EmbeddingResponse;
    return json.data.map((row) => row.embedding);
  }
}

/** Extract the delta token from one SSE `data:` payload; '' if none/parse error. */
function deltaContent(data: string): string {
  try {
    const parsed = JSON.parse(data) as {
      choices?: ReadonlyArray<{ delta?: { content?: string | null } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? '';
  } catch {
    return '';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
