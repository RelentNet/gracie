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
  type EmbedInput,
  type GenerateInput,
  type GenerateResult,
} from './provider.js';

export interface OpenAIAdapterConfig {
  readonly apiKey: string;
  /** Defaults to OpenAI. Override for Azure OpenAI / a compatible proxy. */
  readonly baseUrl?: string;
}

interface ChatCompletionResponse {
  readonly choices: ReadonlyArray<{ readonly message?: { readonly content?: string | null } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
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

  private chatBody(input: GenerateInput, stream: boolean): string {
    const payload: Record<string, unknown> = {
      model: input.model,
      stream,
      messages: [
        { role: 'system', content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };
    if (input.temperature !== undefined) payload.temperature = input.temperature;
    if (input.responseFormat === 'json') payload.response_format = { type: 'json_object' };
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
    const content = json.choices[0]?.message?.content ?? '';
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
