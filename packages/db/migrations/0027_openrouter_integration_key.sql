-- 0026_openrouter_integration_key.sql — a key slot for OpenRouter.
--
-- OpenRouter becomes a first-class generation provider (one key, every model family)
-- and a second route to the pinned embedding model: it serves OpenAI's
-- text-embedding-3-small as `openai/text-embedding-3-small`, so vectors match those
-- embedded directly. See packages/db/src/ai.ts getEmbedder().
--
-- Additive + idempotent, same pattern as 0020. Applies to the SHARED dev+prod
-- Supabase — apply only in coordination with the other developer.
alter type integration_key add value if not exists 'openrouter';
