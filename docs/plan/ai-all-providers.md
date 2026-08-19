# AI: all AI-SDK providers + free-text models + Ollama + Custom

Extends PR #115 (multi-provider AI over the Vercel AI SDK behind the `AIProvider` seam).
#115 shipped a deliberately short catalog (OpenAI + Anthropic only). This opens provider
+ model selection to everything the AI SDK supports — without hardcoding a giant, stale
model list — and consolidates every AI key into the AI Provider settings tab.

OpenAI stays the default; no behavior changes until an admin switches. Embeddings stay
pinned to OpenAI `text-embedding-3-small` (1536-dim, D9).

## What changed

### 1. Providers — every AI-SDK text-generation provider, plus two catch-alls
Added `@ai-sdk/*` packages (versions pinned; all resolve to the SAME
`@ai-sdk/provider@4.0.7` / `provider-utils@5.0.27` already used by `ai@7.0.66`, so they
are drop-in compatible):

| Provider id | Package | Version | Factory |
|---|---|---|---|
| `google` | `@ai-sdk/google` | 4.0.45 | `createGoogleGenerativeAI` |
| `mistral` | `@ai-sdk/mistral` | 4.0.29 | `createMistral` |
| `groq` | `@ai-sdk/groq` | 4.0.28 | `createGroq` |
| `deepseek` | `@ai-sdk/deepseek` | 3.0.28 | `createDeepSeek` |
| `xai` | `@ai-sdk/xai` | 4.0.40 | `createXai` |
| `cohere` | `@ai-sdk/cohere` | 4.0.27 | `createCohere` |
| `perplexity` | `@ai-sdk/perplexity` | 4.0.29 | `createPerplexity` |
| `ollama` / `custom` | `@ai-sdk/openai-compatible` | 3.0.31 | `createOpenAICompatible` |

Each is wired into `PROVIDER_IDS`, `PROVIDER_LABELS`, `INTEGRATION_KEYS` (one encrypted
key slot per provider), and a `createProvider` switch case in `vercel.adapter.ts`.

Speech/transcription-only providers (elevenlabs/deepgram/assemblyai/gladia/hume/lmnt/
revai) are intentionally excluded — this seam is text generation + chat.

Azure OpenAI / Bedrock are **deferred**: they need extra config (resource name / region +
AWS credential chain) beyond a single key+base-URL, so they don't fit the current shape
cleanly. The `custom` (OpenAI-compatible) provider already covers Azure's OpenAI-compatible
route in practice.

### 2. "All models" = presets + free-text (any model id)
The AI SDK accepts any model-id string, so the catalog is now a **starting menu, not an
allowlist**. The Settings model control shows the provider's `MODEL_CATALOG` presets PLUS
a **"Custom model…"** option that reveals a free-text field — type any current/future
model id. Whatever is chosen (preset or typed) persists to `ai_model`.

- Validation relaxed: `setAiProviderModel` only checks the model is non-empty (a bad id
  fails at call time with a provider error — unavoidable for an open field).
- A free-text id has unknown cost → Settings shows "Cost varies — depends on the model you
  enter." instead of a wrong number.
- `MODEL_CATALOG` gained a current preset set per new provider (rough list prices for the
  in-Settings estimate only, not billing). Ollama/Custom have **no** presets (self-hosted /
  arbitrary endpoints — model ids and costs are unknowable) → free-text only.

### 3. Ollama (local)
`ollama` uses the OpenAI-compatible path pointed at the Ollama endpoint. Settings shows a
**base-URL** field (default `http://localhost:11434/v1`) + a free-text **model** field
(e.g. `llama3.1`); API key optional (a local Ollama runs keyless). The "runs on your own
hardware, data never leaves it" story.

### 4. Custom provider (OpenAI-compatible)
`custom` uses the same OpenAI-compatible path with **base URL + API key + model id**.
Covers OpenRouter, LiteLLM, vLLM, LM Studio, Together, Fireworks, and anything
OpenAI-compatible (including Azure's OpenAI-compatible endpoint).

### How the base-URL path works
- Base URL is stored in `settings.ai_base_url` (plaintext — a URL isn't a secret), written
  on every save (empty when the provider doesn't use one, so switching away clears a stale
  endpoint).
- `getActiveProvider` resolves `ai_base_url` for Ollama/Custom and passes it to
  `createProvider` via `ProviderConfig.baseUrl`; their key is optional (missing key is not
  an error — a missing base URL is).
- The `VercelAIAdapter` constructor requires a base URL for Ollama/Custom (instead of a
  non-empty key) and builds `createOpenAICompatible({ name, baseURL, apiKey? })`.

### 5. Settings UX + key consolidation (operator follow-on)
The **AI Provider** tab is now the single place for ALL AI keys:
- Provider dropdown (all providers + Ollama + Custom) → base-URL field (Ollama/Custom
  only) → model (presets + "Custom model…") → the selected provider's API key.
- **OpenAI-for-embeddings key**: embeddings/search are always OpenAI regardless of the
  generation provider, so an always-present **"OpenAI API key — required for
  search/embeddings"** field is surfaced whenever the generation provider is NOT OpenAI
  (reusing the same `openai` credential slot). When the generation provider IS OpenAI, the
  one key covers both — no confusing duplicate field.
- The **API Settings** tab no longer shows OpenAI/Anthropic (or any AI provider): the
  `/api/settings/integrations` list route filters out `PROVIDER_IDS`, leaving Recall,
  Resend, object storage, and MS Graph. This is data-driven (one filter), so the removal
  and the hiding of the new providers are handled in one place.

## Migration
`0019_ai_provider_integration_keys.sql` — additive `ALTER TYPE integration_key ADD VALUE
IF NOT EXISTS …` for the 9 new key slots (google/mistral/groq/deepseek/xai/cohere/
perplexity/ollama/custom). Non-breaking, idempotent; no data backfill. `database.types.ts`
hand-updated to match (enum union + Constants array), consistent with the repo's no-CLI
convention. **Apply in coordination with the orchestrator** (shared dev+prod Supabase).
Storing a key for a NEW provider requires this migration first; OpenAI/Anthropic +
free-text models work without it (the enum already has them / `ai_model` is a plain
setting).

## Preserve (unchanged)
- `AIProvider` interface + all call sites. OpenAI stays the default.
- Embeddings pinned to OpenAI `text-embedding-3-small` (1536-dim); OpenAI key still
  required for embeddings even when generation runs elsewhere.
- Key resolution DB-first via `getCredential` (stored → env fallback).

## Verification
- `pnpm -r typecheck` + `pnpm -r lint` green. Worker tests 223/223 (adds catalog coverage,
  `createProvider` construction for every provider, Ollama/Custom base-URL require/pass-through,
  and free-text-vs-preset).
- Live smoke (dev OpenAI key): preset `gpt-4o-mini` → "OK" (real usage); non-catalog
  free-text `gpt-4o-mini-2024-07-18` → "OK" (proves any id passes straight through);
  Ollama adapter constructs with a base URL.
- **e2e gap**: the other cloud providers can't be keyed in dev, so only OpenAI is
  exercised end-to-end against a live API; the rest are covered by no-network construction
  tests. Selecting them in the UI doesn't break the build.
