-- p9_settings.sql — P9 config seed (DATA, not DDL).
--
-- P9 (Settings / Admin / Scoring) requires NO schema migration: it surfaces
-- existing SQL-only settings as admin UI + adds the scoring-config editor and the
-- pipeline admin. Almost every new/edited key already has a default in its reader,
-- and the settings that predate P9 are already seeded (0004/0007/0010 + p7). This
-- file seeds only the ONE genuinely-new, otherwise-unseeded key for tidiness.
--
-- Deliberately NOT a numbered migration (the next reserved number is 0011, added
-- only if a real schema change lands). Apply via the same `/pg/query` path used for
-- prior seeds, or `psql -f`.
--
-- Storage format MATCHES 0004/0007/p7: `settings.value` is jsonb; scalar settings
-- are stored JSON-encoded via `to_jsonb('...'::text)` (a JSON string). Readers do
-- `typeof value === 'string' ? value : null`.
--
-- Idempotent + NON-CLOBBERING: `on conflict do nothing` never overwrites operator
-- tuning. To CHANGE a value later, use Settings → AI Model (or update it directly).

-- Active generation/chat model (Settings → AI Model). Must be one of the curated
-- ALLOWED_GENERATION_MODELS in @gracie/shared; the reader defaults to this same
-- value when the row is absent, so this seed is optional-but-tidy.
insert into settings (key, value)
values ('ai_model', to_jsonb('gpt-4o'::text))
on conflict (key) do nothing;
