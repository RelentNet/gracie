-- 0009_automations.sql — P8: Gracie Automations (native, agentic engine).
--
-- Gives the Assistant its first *actions*. Non-technical users ask Gracie in chat
-- for recurring reports/tasks; she PROPOSES an automation (never executes in-chat),
-- the user Confirms via a separate gated route, and a worker sweep runs it on a
-- schedule. Three new tables:
--   * automations         — one scheduled/recurring action owned by a user. Starts
--                           life as `pending_confirmation` (proposed, not running);
--                           a deliberate Confirm flips it to `active`.
--   * automation_runs      — an append-only AUDIT row per run (status + detail + any
--                           external recipients emailed — the customer-contact log).
--   * automation_requests  — the admin "advanced requests" inbox: an out-of-catalog
--                           ask Gracie could not build, surfaced for a human.
--
-- SAFETY: `automations_external_send_enabled` (settings, DEFAULT 'false') is the
-- admin master switch for the customer-contact exception. The GA-only email floor
-- in the worker's send choke-point still holds for every normal send.
--
-- Statuses are plain `text` with app-level validation (mirrors 0008's
-- `contact_suggestions.status`) — no new PG enum types, so re-applying is a clean
-- no-op. The ONE enum touched is `notification_type` (+ 'automation') for the
-- reminder action + advanced-request admin notifications.
--
-- Depends on the base schema + P4.1: `users`, `clients`, `settings`, `notifications`.
-- Additive + idempotent (IF NOT EXISTS, guarded). Applies to the SHARED dev+prod
-- Supabase — apply ONLY in coordination with the orchestrator (P8 non-negotiable).

-- 0. Extend the notification_type enum for reminder + advanced-request alerts. --------
--    ADD VALUE IF NOT EXISTS is idempotent; the value is NOT used anywhere in this
--    migration (only at runtime by the worker/web), so it is safe inside the tx.
alter type notification_type add value if not exists 'automation';

-- 1. automations = one scheduled/recurring action owned by a user. -------------------
create table if not exists automations (
  id                     uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null references users(id) on delete cascade,
  title                  text not null,
  intent                 text,                                  -- the natural-language request that created it
  type                   text not null,                         -- automation_type (v1 catalog, app-validated)
  params                 jsonb not null default '{}'::jsonb,    -- action-specific parameters
  schedule               jsonb not null default '{}'::jsonb,    -- {kind:'once'|'interval'|'daily'|'weekly', ...}
  recipients             jsonb not null default '{}'::jsonb,    -- {userIds:[], emails:[], externalEmails:[]}
  has_external_recipient boolean not null default false,        -- gates the customer-contact exception
  status                 text not null default 'pending_confirmation', -- pending_confirmation|active|paused|cancelled
  enabled                boolean not null default false,        -- master on/off (Confirm sets true)
  next_run_at            timestamptz,                           -- when the sweep should next run it
  last_run_at            timestamptz,
  last_run_status        text,                                  -- success|failed|skipped (mirror of latest run)
  confirmed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_automations_owner on automations (owner_user_id);
-- The due-sweep hot path: only enabled+active rows with a due next_run_at.
create index if not exists idx_automations_due
  on automations (next_run_at)
  where enabled and status = 'active';

-- 2. automation_runs = append-only AUDIT of every run (incl. external sends). --------
create table if not exists automation_runs (
  id                  uuid primary key default gen_random_uuid(),
  automation_id       uuid not null references automations(id) on delete cascade,
  status              text not null,                            -- success|failed|skipped
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  detail              text,                                     -- human-readable outcome / error
  external_recipients text[] not null default '{}',            -- addresses emailed under the §2b exception (audit)
  created_at          timestamptz not null default now()
);
create index if not exists idx_automation_runs_automation
  on automation_runs (automation_id, created_at desc);

-- 3. automation_requests = the admin "advanced requests" inbox (out-of-catalog). -----
create table if not exists automation_requests (
  id                    uuid primary key default gen_random_uuid(),
  requested_by_user_id  uuid references users(id) on delete set null,
  intent                text not null,                          -- the NL ask Gracie could not build
  status                text not null default 'pending',        -- pending|accepted|dismissed
  notes                 text,
  resolved_by_user_id   uuid references users(id) on delete set null,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists idx_automation_requests_status on automation_requests (status);

-- 4. Seed the external-send master switch OFF (idempotent). --------------------------
--    Stored JSON-encoded as a string (matches 0004/0005/p7 + the setting readers,
--    which do `typeof value === 'string' ? value : null` then parse).
insert into settings (key, value)
values ('automations_external_send_enabled', to_jsonb('false'::text))
on conflict (key) do nothing;
