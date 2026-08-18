# AI SDK migration — multi-provider AI (PR 1: OpenAI default + Anthropic selectable)

Moves Gracie's AI layer onto the **Vercel AI SDK** so the generation model is
provider-agnostic. OpenAI stays the default; an admin can switch to Anthropic (Claude)
by picking a provider + model and entering that provider's key. **No behavior change on
a fresh deploy** — provider/model default to OpenAI + gpt-4o.

## What shipped

- **`VercelAIAdapter implements AIProvider`** (`packages/shared/src/ai/vercel.adapter.ts`)
  replaces the bespoke fetch-based `OpenAIAdapter` (deleted) as the impl
  `createProvider` returns. One adapter backs every provider.
  - `generate` → `generateText`, or `generateObject({ output: 'no-schema' })` when
    `responseFormat === 'json'` (≈ OpenAI json_object mode). Maps `GenerateInput.tools`
    (JSON-Schema params) → AI SDK tools via `jsonSchema()`, honors `toolChoice`
    (auto/none/required), and maps results back to `GenerateResult` including
    `toolCalls` (id/name/RAW-args-string), `finishReason`, and `usage`
    (`inputTokens`/`outputTokens` → `promptTokens`/`completionTokens`).
  - `stream` → `streamText`, yields text deltas. `textStream` swallows error parts, so
    an `onError` captures and the generator rethrows after draining (the assistant
    route already wraps this in try/catch).
  - `embed` → **always OpenAI `text-embedding-3-small` (1536-dim, D9)** via `embedMany`.
    The anthropic adapter has no embedder and throws if `embed` is ever called — but it
    never is: `getEmbedder` always builds an OpenAI provider, so switching generation to
    Anthropic never changes stored vectors.
  - Tools are advertised WITHOUT an `execute` fn, so the model returns the call and
    stops — the caller's buffered tool-loop runs it and re-generates, exactly as before.
- **Structured model catalog** (`packages/shared/src/ai/provider.ts`) replaces the flat
  `ALLOWED_GENERATION_MODELS`: `MODEL_CATALOG` of
  `{ providerId, model, label, supportsTools, supportsJson, costPer1MInput, costPer1MOutput }`
  covering OpenAI (gpt-4o / 4o-mini / 4.1 / 4.1-mini) + Anthropic (Claude Sonnet 4.5 /
  Haiku 4.5 / Opus 4.5). Helpers: `listModelsForProvider`, `findModel`, `isProviderId`,
  `estimateCentsPerMeetingHour`. `DEFAULT_GENERATION_PROVIDER = 'openai'`,
  `DEFAULT_GENERATION_MODEL = 'gpt-4o'` (unchanged default).
- **Provider resolution** (`packages/db/src/ai.ts`): `getActiveProvider` now reads
  `settings.ai_provider` (default openai), resolves that provider's key via
  `getCredential(providerId)`, and constructs the adapter. `getEmbedder` stays pinned to
  the OpenAI key. Key resolution is still DB-first (stored → env fallback).
- **Settings UX** (`AiSettingsPanel.tsx`, `api/settings/ai/route.ts`,
  `lib/data/ai-settings.ts`): three controls — Provider dropdown, Model dropdown (shows
  `~X¢ per hour of meetings`), and an API-key field for the selected provider. Save
  writes `ai_provider` + `ai_model` (validated as a coherent pair) + the encrypted key
  via the existing `setIntegration`/`integration_credentials` path (one slot per
  provider, keys persist across switches). A persistent note explains embeddings always
  use OpenAI and an OpenAI key is required even on Anthropic. Admin-gated as before. Tab
  renamed "AI Model" → "AI Provider".

## Versions pinned

`ai@7.0.66`, `@ai-sdk/openai@4.0.42`, `@ai-sdk/anthropic@4.0.39` (added to
`packages/shared`; `zod@4.4.3` pulled as the SDK's peer). AI SDK v5+/v7 shapes: `usage`
is `{inputTokens, outputTokens}`, tool params are `inputSchema` (via `jsonSchema()`),
tool calls carry `.input` (parsed object) → re-serialized to a raw JSON string.

## Migrations

**None.** `anthropic` is already in the `integration_key` enum and `ai_provider` is a
`settings` key/value row — both pre-exist. No schema change, no types regen.

## Verified

- `pnpm -r typecheck` clean, `pnpm -r lint` clean (0 warnings), tests 281/281 pass
  (215 worker incl. 12 new adapter/catalog unit tests in
  `apps/worker/src/lib/vercel-adapter.test.ts`, 66 web).
- **Live OpenAI wire smoke test** (throwaway script vs the dev OpenAI key): text
  generation (usage + finishReason=stop), JSON mode (valid parseable object), tool call
  (`get_weather` → raw args `{"city":"Paris"}`, finishReason=tool-calls), streaming
  (yields deltas), embeddings (2 rows × **1536 dim**). All pass.
- Unchanged call sites: assistant tool-loop, chat streaming route, worker generate/JSON
  extraction, kb-ingest/ingest embeddings — the `AIProvider` interface is untouched.

## e2e gap

Anthropic could **not** be exercised end-to-end in dev (no Anthropic key). It is
type-checked and build-safe; selecting it constructs the adapter and calls the Claude
model, but the live Claude round-trip is unverified. First real switch should be
smoke-tested once an Anthropic key is entered in Settings → AI.

## Out of scope (PR 2)

Ollama/local provider (catalog + adapter switch are left trivially extensible — add an
id to `PROVIDER_IDS`, a catalog block, and a case in the adapter switch); real-spend
cost calibration (the per-hour estimate uses public list prices + a rough
avg-tokens-per-meeting constant).
