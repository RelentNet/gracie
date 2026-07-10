-- p4_2_manual_join.sql — P4.2 config seed (DATA, not DDL).
--
-- P4.2 (On-demand meeting join) requires NO schema migration: `meeting_source`
-- already has 'manual', and this is the only new `settings` row. Deliberately NOT
-- a numbered migration — migration 0008 is reserved for the Contacts phase.
-- Apply via the same `/pg/query` path used for prior settings seeds, or `psql -f`.
--
-- Storage format MATCHES the P7 seed + the bot-dispatch kill-switch: scalar
-- settings are stored JSON-encoded via `to_jsonb('...'::text)` (a JSON string);
-- the readers do `value === 'true'`.
--
-- Idempotent + NON-CLOBBERING: `on conflict do nothing` so re-applying never
-- overwrites the operator's chosen value.

-- Master switch for on-demand meeting join. INDEPENDENT of the auto-dispatch
-- kill-switch (`calendar_bot_dispatch_enabled`): that gates the AUTOMATIC calendar
-- cron; this gates the EXPLICIT "paste a link → Gracie joins now" action.
--
-- ⚠️ DEFAULT OFF (fail-safe, matches the cautious bot posture). On-demand join is
-- how Recall starts being used in earnest (auto-dispatch has been OFF), so it is
-- shipped OFF and the operator flips it on when ready — either here (change to
-- 'true') or in the UI (Calendar → Connection panel, Admin only).
insert into settings (key, value)
values ('manual_join_enabled', to_jsonb('false'::text))
on conflict (key) do nothing;
