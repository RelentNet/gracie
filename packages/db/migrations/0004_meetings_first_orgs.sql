-- 0004_meetings_first_orgs.sql (P4.1 — Meetings-first orgs & multi-client calendar)
--
-- Extends the merged P4 Calendar (docs/plan/p4.1-meetings-first-orgs.md). Reshapes
-- how calendar meetings become client records:
--   * `client_type` on clients (client/prospect/lead/partner/internal) — one
--     domain-keyed table for all parties; "promote a lead → client" flips `type`.
--   * `client_domains` — the domain→org match key (global unique; the primary
--     matching signal, replacing subject/alias guessing).
--   * `meeting_clients` — many-to-many meeting↔client (multi-client meetings).
--   * `meetings.is_internal` + `meetings.external_attendees` — internal-only flag
--     and captured external (non-GA) attendee emails/domains (external parties are
--     NOT persisted today; `attendee_user_ids` holds only INTERNAL user uuids).
--   * the Grace & Associates `internal` org — home for internal meetings/notes/files.
--   * `settings.internal_email_domains` — configurable internal-domain list.
--
-- Depends on the base schema (docs/04-database-schema.sql): `clients`, `meetings`,
-- `settings`. Idempotent (IF NOT EXISTS, guarded create type, ON CONFLICT / WHERE
-- NOT EXISTS) so re-applying is a no-op. Additive only — nothing is dropped or
-- rewritten, so every existing `meetings.client_id` read keeps working.

-- 1. Party type on clients.
do $$ begin
  create type client_type as enum ('client','prospect','lead','partner','internal');
exception when duplicate_object then null; end $$;
alter table clients add column if not exists type client_type not null default 'client';
create index if not exists idx_clients_type on clients (type);

-- 2. Domain → org. THE match key. A domain maps to exactly one org (global unique).
create table if not exists client_domains (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  domain     text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_client_domains_domain on client_domains (lower(domain));
create index if not exists idx_client_domains_client on client_domains (client_id);

-- 3. Many-to-many meeting ↔ client (multi-client meetings).
create table if not exists meeting_clients (
  meeting_id uuid not null references meetings(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, client_id)
);
create index if not exists idx_meeting_clients_client on meeting_clients (client_id);

-- 4. Meetings: internal flag + external-attendee capture.
alter table meetings add column if not exists is_internal boolean not null default false;
alter table meetings add column if not exists external_attendees jsonb not null default '[]'::jsonb;
-- external_attendees shape: [{ "email": string, "name": string|null, "domain": string }]

-- 5. Seed the Grace & Associates internal org (the home for internal meetings).
insert into clients (name, initials, type, cadence, description)
select 'Grace & Associates', 'GA', 'internal', 'ad_hoc',
       'Internal workspace — team meetings, notes, and files.'
where not exists (select 1 from clients where type = 'internal');

-- 6. Internal email domains live in settings (configurable, no deploy needed).
--    `settings.value` is jsonb, so store the string JSON-encoded (via to_jsonb) to
--    match how the app persists scalar settings (`"true"`, ISO timestamps, …).
insert into settings (key, value)
values ('internal_email_domains', to_jsonb('graceandassociates.com'::text))
on conflict (key) do nothing;
