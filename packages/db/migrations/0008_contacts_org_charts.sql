-- 0008_contacts_org_charts.sql — Contacts & Org Charts (phase `CO`).
--
-- A standalone pre-launch capability: a top-level Contacts area + a per-org office
-- hierarchy (the org chart). Four new tables:
--   * contacts             — people (org-agnostic; linked to orgs via affiliations).
--   * offices              — org-chart NODES: an office/position that belongs to an
--                            org, has a reports-to parent, and CAN BE VACANT.
--   * contact_affiliations — contact ↔ org (+ optional office) WITH tenure history and
--                            multi-org support (see someone move VA → a client over time).
--   * contact_suggestions  — a source-agnostic inbox (calendar attendees now; a future
--                            n8n web-scan later) of people to add.
-- "Org" = a `clients` row of ANY `type` (client/prospect/lead/partner/internal, P4.1).
--
-- Depends on the base schema + P4.1: `clients`, `meetings`, `users`. Additive +
-- idempotent (IF NOT EXISTS, guarded indexes) so re-applying is a no-op; nothing is
-- dropped or rewritten. Applies to the SHARED dev+prod Supabase — apply ONLY in
-- coordination with the orchestrator (CO non-negotiable).

-- 1. Contacts = people (org-agnostic; linked via affiliations). ----------------------
create table if not exists contacts (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null,
  email              text,
  phone              text,
  linkedin_url       text,
  notes              text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_contacts_name  on contacts (lower(full_name));
create index if not exists idx_contacts_email on contacts (lower(email));

-- 2. Offices / positions per org = the org-chart NODES. Can be VACANT. ---------------
create table if not exists offices (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,   -- the org
  title            text not null,
  parent_office_id uuid references offices(id) on delete set null,           -- reports-to (hierarchy)
  description      text,
  is_key           boolean not null default false,                           -- flag important offices to watch (esp. when vacant)
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_offices_client on offices (client_id);
create index if not exists idx_offices_parent on offices (parent_office_id);

-- 3. Affiliations = contact ↔ org (+ optional office) WITH history + multi-org. ------
create table if not exists contact_affiliations (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,        -- the org
  office_id   uuid references offices(id) on delete set null,                -- optional formal office
  title       text,                                                          -- freeform title when no office
  org_email   text,                                                          -- org-specific contact info (optional)
  org_phone   text,
  started_on  date,
  ended_on    date,                                                          -- null = ongoing
  is_current  boolean not null default true,                                 -- app-maintained (see invariants)
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_affil_contact on contact_affiliations (contact_id);
create index if not exists idx_affil_client  on contact_affiliations (client_id);
create index if not exists idx_affil_office  on contact_affiliations (office_id) where office_id is not null;
create index if not exists idx_affil_current on contact_affiliations (is_current) where is_current;
-- At most ONE current holder per office (the vacant/filled invariant):
create unique index if not exists uq_office_current_holder
  on contact_affiliations (office_id) where office_id is not null and is_current;

-- 4. Suggestions queue (source-agnostic: calendar attendees now, n8n web-scan later). --
create table if not exists contact_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null,                        -- 'calendar_attendee' | 'n8n_web' | ...
  suggested_name      text,
  suggested_email     text,
  suggested_domain    text,
  client_id           uuid references clients(id) on delete set null,   -- guessed org (by domain)
  office_id           uuid references offices(id) on delete set null,   -- if suggesting a fill for a vacant office
  meeting_id          uuid references meetings(id) on delete set null,  -- provenance (calendar source)
  payload             jsonb not null default '{}'::jsonb,
  status              text not null default 'pending',      -- 'pending' | 'accepted' | 'dismissed'
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by_user_id uuid references users(id) on delete set null
);
-- One pending suggestion per (source, email) — the generator's spam guard.
create unique index if not exists uq_suggestion_dedup
  on contact_suggestions (source, lower(suggested_email))
  where suggested_email is not null and status = 'pending';
create index if not exists idx_suggestions_status on contact_suggestions (status);
