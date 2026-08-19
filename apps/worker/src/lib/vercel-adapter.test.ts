/**
 * VercelAIAdapter mapping + model-catalog guards (D11 multi-provider). Pure: exercises
 * the neutral↔AI-SDK translation and the catalog helpers with no network / no LLM, so
 * a regression in the provider seam fails here instead of at call time.
 *
 * Covers: message expansion (tool-call / tool-result round-trip incl. recovered
 * toolName), tools mapping + toolChoice-less empty case, tool-call result mapping,
 * usage token rename, and (provider, model) catalog validation + cost estimate.
 *
 * Pure — run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createProvider,
  DEFAULT_GENERATION_MODEL,
  DEFAULT_GENERATION_PROVIDER,
  DEFAULT_OLLAMA_BASE_URL,
  estimateCentsPerMeetingHour,
  findModel,
  isProviderId,
  listModelsForProvider,
  MODEL_CATALOG,
  OPENAI_COMPATIBLE_PROVIDERS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  providerNeedsBaseUrl,
  toAIToolCalls,
  toModelMessages,
  toToolSet,
  toUsage,
  type ProviderId,
} from '@gracie/shared';

test('toModelMessages maps plain user/assistant turns 1:1', () => {
  const out = toModelMessages([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
});

test('toModelMessages expands an assistant tool-call turn to content parts', () => {
  const [msg] = toModelMessages([
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'lookup', arguments: '{"q":"acme"}' }],
    },
  ]);
  assert.ok(msg !== undefined);
  assert.equal(msg.role, 'assistant');
  assert.deepEqual(msg.content, [
    { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { q: 'acme' } },
  ]);
});

test('toModelMessages keeps assistant text alongside a tool call', () => {
  const [msg] = toModelMessages([
    {
      role: 'assistant',
      content: 'let me check',
      toolCalls: [{ id: 'c1', name: 't', arguments: '{}' }],
    },
  ]);
  assert.ok(msg !== undefined);
  assert.deepEqual(msg.content, [
    { type: 'text', text: 'let me check' },
    { type: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
  ]);
});

test('toModelMessages recovers the tool name for a tool-result from the matching call', () => {
  const out = toModelMessages([
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_9', name: 'search_web', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'call_9', content: 'result text' },
  ]);
  const toolMsg = out[1];
  assert.ok(toolMsg !== undefined);
  assert.equal(toolMsg.role, 'tool');
  assert.deepEqual(toolMsg.content, [
    { type: 'tool-result', toolCallId: 'call_9', toolName: 'search_web', output: { type: 'text', value: 'result text' } },
  ]);
});

test('toModelMessages tolerates malformed tool-call args (falls back to {})', () => {
  const [msg] = toModelMessages([
    { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'n', arguments: 'not json' }] },
  ]);
  assert.ok(msg !== undefined);
  const parts = msg.content as Array<{ input: unknown }>;
  assert.deepEqual(parts[0]?.input, {});
});

test('toToolSet returns undefined for no tools and an object keyed by name otherwise', () => {
  assert.equal(toToolSet(undefined), undefined);
  assert.equal(toToolSet([]), undefined);
  const set = toToolSet([
    { name: 'a', description: 'da', parameters: { type: 'object', properties: {} } },
    { name: 'b', description: 'db', parameters: { type: 'object', properties: {} } },
  ]);
  assert.ok(set !== undefined);
  assert.deepEqual(Object.keys(set), ['a', 'b']);
});

test('toAIToolCalls maps SDK calls to neutral shape with RAW JSON-string args', () => {
  const calls = toAIToolCalls([
    { toolCallId: 'x1', toolName: 'foo', input: { a: 1, b: 'two' } },
    { toolCallId: 'x2', toolName: 'bar', input: undefined },
  ]);
  assert.deepEqual(calls, [
    { id: 'x1', name: 'foo', arguments: '{"a":1,"b":"two"}' },
    { id: 'x2', name: 'bar', arguments: '{}' },
  ]);
});

test('toUsage renames input/output token counts and defaults missing to 0', () => {
  assert.deepEqual(toUsage({ inputTokens: 10, outputTokens: 4 } as never), { promptTokens: 10, completionTokens: 4 });
  assert.deepEqual(toUsage({ inputTokens: undefined, outputTokens: undefined } as never), {
    promptTokens: 0,
    completionTokens: 0,
  });
});

test('catalog: every entry has a known provider and positive prices', () => {
  for (const m of MODEL_CATALOG) {
    assert.ok((PROVIDER_IDS as readonly string[]).includes(m.providerId), `${m.model} provider`);
    assert.ok(m.costPer1MInput > 0 && m.costPer1MOutput > 0, `${m.model} prices`);
  }
});

test('catalog: default provider+model is a valid selectable pair', () => {
  assert.ok(isProviderId(DEFAULT_GENERATION_PROVIDER));
  assert.ok(findModel(DEFAULT_GENERATION_PROVIDER, DEFAULT_GENERATION_MODEL) !== undefined);
});

test('catalog: findModel rejects a cross-provider pair', () => {
  assert.equal(findModel('anthropic', 'gpt-4o'), undefined);
  assert.ok(findModel('openai', 'gpt-4o') !== undefined);
  assert.ok(listModelsForProvider('anthropic').length > 0);
});

test('catalog: cost estimate is positive and cheaper for a mini model', () => {
  const full = findModel('openai', 'gpt-4o');
  const mini = findModel('openai', 'gpt-4o-mini');
  assert.ok(full !== undefined && mini !== undefined);
  assert.ok(estimateCentsPerMeetingHour(mini) > 0);
  assert.ok(estimateCentsPerMeetingHour(mini) < estimateCentsPerMeetingHour(full));
});

// --- multi-provider: catalog coverage + createProvider construction (no network) ------

/** Providers with API-keyed SDKs (not the OpenAI-compatible base-URL ones). */
const KEYED_PROVIDERS: readonly ProviderId[] = [
  'openai',
  'anthropic',
  'google',
  'mistral',
  'groq',
  'deepseek',
  'xai',
  'cohere',
  'perplexity',
];

test('catalog: every keyed provider has at least one preset; Ollama/Custom have none (free-text)', () => {
  for (const id of KEYED_PROVIDERS) {
    assert.ok(listModelsForProvider(id).length > 0, `${id} presets`);
  }
  assert.equal(listModelsForProvider('ollama').length, 0);
  assert.equal(listModelsForProvider('custom').length, 0);
});

test('providerNeedsBaseUrl is true only for Ollama + Custom', () => {
  assert.deepEqual([...OPENAI_COMPATIBLE_PROVIDERS].sort(), ['custom', 'ollama']);
  assert.ok(providerNeedsBaseUrl('ollama') && providerNeedsBaseUrl('custom'));
  for (const id of KEYED_PROVIDERS) assert.ok(!providerNeedsBaseUrl(id), `${id} no base url`);
});

test('every provider id has a label', () => {
  for (const id of PROVIDER_IDS) assert.equal(typeof PROVIDER_LABELS[id], 'string');
});

test('createProvider: each keyed provider constructs with a key (no throw, no network)', () => {
  for (const id of KEYED_PROVIDERS) {
    const p = createProvider(id, { apiKey: 'test-key' });
    assert.equal(p.id, id);
  }
});

test('createProvider: keyed provider throws on empty key', () => {
  assert.throws(() => createProvider('anthropic', { apiKey: '' }));
});

test('createProvider: Ollama/Custom construct with a base URL and pass it through', () => {
  const ollama = createProvider('ollama', { apiKey: '', baseUrl: DEFAULT_OLLAMA_BASE_URL });
  assert.equal(ollama.id, 'ollama');
  const custom = createProvider('custom', { apiKey: 'sk-x', baseUrl: 'https://openrouter.ai/api/v1' });
  assert.equal(custom.id, 'custom');
});

test('createProvider: Ollama/Custom throw when the base URL is missing', () => {
  assert.throws(() => createProvider('ollama', { apiKey: '' }));
  assert.throws(() => createProvider('custom', { apiKey: 'sk-x' }));
});

test('a free-text model id is not a catalog preset (findModel undefined) but is still usable', () => {
  // Free text never matches a preset; the adapter passes any id straight to the SDK.
  assert.equal(findModel('openai', 'gpt-5-some-future-id'), undefined);
  assert.equal(findModel('ollama', 'llama3.1'), undefined);
});
