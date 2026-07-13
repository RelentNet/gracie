-- 0010_automations_event_triggers.sql — P8.1: shorter intervals + meeting/event triggers.
--
-- Extends the P8 automations engine (0009) with an EVENT-driven trigger kind
-- (`before_meeting`) and a configurable interval floor. Two things change:
--
--   * automation_runs gains a nullable `meeting_id` (FK meetings ON DELETE CASCADE)
--     plus a UNIQUE PARTIAL INDEX on (automation_id, meeting_id) where meeting_id is
--     not null. This is the exactly-once claim for event automations: each meeting can
--     fire a given event automation AT MOST ONCE (a duplicate INSERT raises 23505,
--     which the worker's event pass treats as "already fired"). Schedule-based runs
--     (client_report/portfolio_digest/… and any manual "Run now") keep meeting_id NULL
--     and are unaffected by the partial index.
--
--   * settings.automations_min_interval_minutes — the configurable floor (minutes) for
--     recurring `interval` automations (default 60 = hourly; an admin can tune it to 30
--     via SQL). Read by the Assistant's create_automation validation. Per-minute stays
--     impossible: the floor is bounded ≥ the ~5-min automations sweep cadence in code.
--
-- The `meeting_brief` action is a plain app-validated `text` value on automations.type
-- (like every other automation type in 0009) — there is NO Postgres enum for
-- automation types, so nothing to ALTER TYPE here. Only `notification_type` is a real
-- enum, and this migration does not touch it.
--
-- Additive + idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING), style of 0009.
-- Depends on 0009 (`automations`, `automation_runs`) + the base `meetings` table.
-- Applies to the SHARED dev+prod Supabase — apply ONLY in coordination with the
-- orchestrator (P8 non-negotiable).

-- 1. Event-trigger idempotency: which meeting a run fired for (event automations). ----
--    Nullable + ON DELETE CASCADE so deleting a meeting drops its brief-run rows.
alter table automation_runs
  add column if not exists meeting_id uuid references meetings(id) on delete cascade;

-- Exactly-once per (automation, meeting): only constrains event-fire rows (meeting_id
-- not null); schedule/manual runs (meeting_id null) are never blocked by it.
create unique index if not exists uq_automation_runs_automation_meeting
  on automation_runs (automation_id, meeting_id)
  where meeting_id is not null;

-- Speeds the event pass's "already fired?" pre-check for one automation's candidates.
create index if not exists idx_automation_runs_meeting
  on automation_runs (meeting_id)
  where meeting_id is not null;

-- 2. Seed the configurable interval floor (minutes). ---------------------------------
--    Stored JSON-encoded as a string (matches 0004/0005/0009 + the setting readers,
--    which do `typeof value === 'string' ? value : null` then parse). Default 60 (hourly).
insert into settings (key, value)
values ('automations_min_interval_minutes', to_jsonb('60'::text))
on conflict (key) do nothing;
