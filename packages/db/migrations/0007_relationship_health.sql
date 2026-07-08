-- 0007_relationship_health.sql (P2.1 — algorithmic relationship health)
--
-- Turns `clients.relationship_health` / `relationship_trend` from seed-only columns into
-- an ALGORITHM (see docs/plan/p2.1-stage-a-plan.md §2). A worker job recomputes a 0-100
-- score from four weighted signals (cadence adherence, meeting recency, open/overdue tasks,
-- task completion) nightly + on events, snapshots it, and derives the trend from history.
--
-- Additive + idempotent — safe to re-run. Applies to the SHARED dev+prod Supabase; apply
-- only in coordination with the orchestrator (P2.1 non-negotiable). Touches NO existing
-- data except seeding one new `settings` row (guarded with `do nothing`).

-- 1. Per-client health snapshot log (for trend derivation + an audit trail of the score). ----
create table if not exists client_health_history (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  score       integer not null check (score between 0 and 100),
  breakdown   jsonb,                         -- per-signal computed/effective values + weights
  computed_at timestamptz not null default now()
);
create index if not exists idx_client_health_history_client
  on client_health_history (client_id, computed_at desc);

-- 2. When the score was last (re)computed — an "auto" freshness marker on the client row. -----
alter table clients add column if not exists health_updated_at timestamptz;

-- 3. Admin per-signal adjustments (Q2): the score stays PURELY COMPUTED, but an admin may
--    override an individual signal's normalized 0-100 value with a required reason (e.g. "this
--    open task is genuinely long-running — don't penalize"). Shape:
--      { "openOverdueTasks": { "value": 85, "reason": "...", "byUserId": "uuid", "at": "iso" } }
--    The recompute uses `adjustment.value ?? computedValue` per signal. Also accepts a future
--    `meetingSentiment` signal without a schema change.
alter table clients add column if not exists health_adjustments jsonb;

-- 4. Tunable algorithm config (weights/thresholds/intervals) so the operator retunes without a
--    deploy. `settings.value` is jsonb; this is a jsonb OBJECT (unlike the scalar-string settings
--    such as `internal_email_domains`). Readers cast it and fall back to a hardcoded default, so
--    the row is optional. `do nothing` on conflict → never clobber operator tuning on re-apply.
insert into settings (key, value)
values (
  'relationship_health_config',
  jsonb_build_object(
    'weights', jsonb_build_object(
      'cadenceAdherence', 45,
      'meetingRecency', 20,
      'openOverdueTasks', 20,
      'completionRate', 15
    ),
    'cadenceIntervalDays', jsonb_build_object(
      'weekly', 7,
      'biweekly', 14,
      'monthly', 30,
      'qbr', 90
    ),
    'recencyFullDays', 30,
    'recencyZeroDays', 90,
    'overduePenaltyPerTask', 15,
    'overdueAgePenaltyPerDay', 1,
    'noMeetingsScore', 0,
    'trendCompareDays', 14,
    'trendThreshold', 5
  )
)
on conflict (key) do nothing;
