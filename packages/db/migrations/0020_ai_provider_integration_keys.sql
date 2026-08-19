-- 0020_ai_provider_integration_keys.sql — one encrypted key slot per AI provider.
--
-- PR #115 opened the AI seam to multiple providers but shipped only openai + anthropic.
-- This widens the `integration_key` enum so EVERY selectable generation provider gets
-- its own row in `integration_credentials` (encrypted key + non-secret config):
--   - google / mistral / groq / deepseek / xai / cohere / perplexity  (@ai-sdk/* SDKs)
--   - ollama  (local, OpenAI-compatible — key optional, base URL in settings.ai_base_url)
--   - custom  (any OpenAI-compatible endpoint — OpenRouter/LiteLLM/vLLM/… — base URL + key)
--
-- Keys stay per-provider so switching the active provider never loses another's key.
-- The OpenAI slot is unchanged and still required for embeddings (pinned, D9), so the
-- OpenAI key survives even when generation runs on another provider.
--
-- `ADD VALUE` is additive + non-breaking. `IF NOT EXISTS` makes it idempotent. The new
-- values are NOT referenced elsewhere in this migration, so ADD VALUE is safe inside the
-- transaction (same pattern as 0018's client_type / 0009's notification_type).
--
-- Applies to the SHARED dev+prod Supabase — apply ONLY in coordination with the
-- orchestrator. No data backfill; no other schema change.
alter type integration_key add value if not exists 'google';
alter type integration_key add value if not exists 'mistral';
alter type integration_key add value if not exists 'groq';
alter type integration_key add value if not exists 'deepseek';
alter type integration_key add value if not exists 'xai';
alter type integration_key add value if not exists 'cohere';
alter type integration_key add value if not exists 'perplexity';
alter type integration_key add value if not exists 'ollama';
alter type integration_key add value if not exists 'custom';
