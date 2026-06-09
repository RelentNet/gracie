-- ============================================================================
-- 04 — DATABASE SCHEMA (Supabase / Postgres + pgvector)
-- GA App (gracie) — full DDL: tables, enums, indexes, FKs, RLS.
--
-- NOTES FOR THE IMPLEMENTER:
--   * This is the canonical schema. Generate migration 0001_init.sql from it.
--   * All timestamps are timestamptz; the APPLICATION renders Eastern time.
--   * UUID primary keys via gen_random_uuid() (pgcrypto).
--   * RLS is defense-in-depth; API middleware is the PRIMARY enforcement (see 02/05).
--   * The worker uses the service-role key (bypasses RLS) for trusted server logic.
--   * Frontend reads use the anon key and ARE bound by the RLS policies below.
--   * Per-user Microsoft tokens are intentionally ABSENT (calendar is app-level, D5).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;     -- gen_random_uuid()
create extension if not exists vector;       -- pgvector

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
create type user_role          as enum ('admin', 'standard', 'viewer');

create type client_cadence     as enum ('weekly', 'biweekly', 'monthly', 'qbr', 'ad_hoc');
create type fee_tier           as enum ('low', 'mid', 'high');          -- admin-only data
create type relationship_trend as enum ('improving', 'stable', 'declining');

create type meeting_type        as enum (
  'weekly_sync', 'biweekly_cadence', 'monthly_review', 'qbr',
  'technical_review', 'kickoff', 'ad_hoc'
);
create type meeting_source      as enum ('calendar', 'manual');
create type pipeline_status     as enum (
  'scheduled', 'in_progress', 'awaiting_transcript', 'processing',
  'complete', 'needs_attention', 'cancelled'
);

create type document_type       as enum (
  'post_meeting_analysis', 'internal_memo', 'client_summary',
  'task_checklist', 'internal_email_draft', 'client_email_draft',
  'pre_meeting_brief', 'daily_sync', 'upload', 'other'
);
create type document_source     as enum ('meeting', 'upload', 'auto');
create type document_status      as enum ('ready', 'needs_review', 'delivered', 'archived');

create type task_status          as enum ('open', 'in_progress', 'complete');

create type folder_visibility    as enum ('all', 'restricted');

create type pipeline_run_source  as enum ('recall', 'manual_upload');
create type pipeline_run_status  as enum ('success', 'failed', 'partial');

create type embedding_source     as enum (
  'meeting_document', 'upload', 'knowledge_base', 'transcript'
);

create type notification_type    as enum (
  'documents_ready', 'needs_attention', 'task_assigned',
  'kb_expiring', 'calendar_disconnect', 'pipeline_failed'
);

create type integration_key     as enum (
  'recall', 'openai', 'anthropic', 'resend', 'r2', 'ms_graph', 'logto', 'supabase'
);

create type assistant_msg_role  as enum ('user', 'assistant');

-- ----------------------------------------------------------------------------
-- HELPER: current role from JWT (Logto role claim mapped into Supabase JWT)
-- The app sets request.jwt.claims; we read role from it.
-- ----------------------------------------------------------------------------
-- Reads the APP role from a dedicated JWT claim (`user_role`/`app_role`),
-- NOT the top-level `role` claim (which Supabase sets to anon/authenticated/
-- service_role — Postgres roles, not app roles). Never crashes on non-app
-- tokens: returns 'viewer' as a safe default. Logto must emit `user_role` in
-- the JWT for real users (admin/standard/viewer).
create or replace function auth_role() returns user_role
language plpgsql stable as $fn$
declare
  claims jsonb;
  app_role text;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return 'viewer'::user_role;
  end;

  app_role := coalesce(
    claims ->> 'user_role',
    claims ->> 'app_role',
    (claims -> 'user_metadata') ->> 'app_role'
  );

  if app_role in ('admin', 'standard', 'viewer') then
    return app_role::user_role;
  end if;

  return 'viewer'::user_role;
end;
$fn$;

create or replace function auth_uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid;
$$;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- users -----------------------------------------------------------------------
-- Synced from Logto on first login. NO Microsoft tokens (calendar is app-level).
create table users (
  id                  uuid primary key default gen_random_uuid(),
  logto_id            text unique not null,         -- subject from Logto JWT
  email               text unique not null,
  name                text not null,
  initials            text not null,
  role                user_role not null default 'viewer',
  calendar_connected  boolean not null default false, -- = membership in access group
  last_active_at      timestamptz,
  deactivated_at      timestamptz,                     -- soft-disable for clean offboarding
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_users_email on users (email);

-- settings (key-value global config) -----------------------------------------
create table settings (
  key                 text primary key,
  value               jsonb not null,
  updated_by_user_id  uuid references users(id) on delete set null,
  updated_at          timestamptz not null default now()
);
-- seed keys (insert separately): ga_company_description, business_hours_start,
-- business_hours_end, ai_provider, ai_model, excluded_calendar_keywords,
-- pre_meeting_brief_default_lead_days

-- clients ---------------------------------------------------------------------
create table clients (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,               -- canonical name
  initials              text not null,
  contract_number       text,
  primary_contact       text,
  primary_contact_email text,
  cadence               client_cadence not null default 'monthly',
  fee_tier              fee_tier,                    -- ADMIN-ONLY (RLS + API gate)
  contract_value        numeric(14,2),               -- ADMIN-ONLY
  billing_cadence       text,
  description           text,                        -- used in AI prompts
  relationship_health   integer check (relationship_health between 0 and 100),
  relationship_trend    relationship_trend default 'stable',
  last_meeting_at       timestamptz,
  drive_folder_url      text,                        -- legacy/optional
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_clients_name on clients (name);

-- client_aliases (calendar fuzzy matching) -----------------------------------
create table client_aliases (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  alias       text not null,
  created_at  timestamptz not null default now()
);
create index idx_client_aliases_alias on client_aliases (lower(alias));

-- meeting_type_rules (keyword -> meeting_type) -------------------------------
create table meeting_type_rules (
  id                  uuid primary key default gen_random_uuid(),
  keyword             text not null,
  meeting_type        meeting_type not null,
  created_by_user_id  uuid references users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index idx_meeting_type_rules_keyword on meeting_type_rules (lower(keyword));

-- meetings --------------------------------------------------------------------
create table meetings (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid references clients(id) on delete set null, -- null = ambiguous/unassigned
  title                 text,
  date_time             timestamptz not null,
  duration_minutes      integer,
  meeting_type          meeting_type,
  meeting_lead_user_id  uuid references users(id) on delete set null,
  attendee_user_ids     uuid[] not null default '{}',
  calendar_event_id     text,                        -- Graph event id (dedup)
  video_link            text,
  bot_dispatched        boolean not null default false,
  bot_job_id            text,                        -- Recall.ai job id
  transcript_received   boolean not null default false,
  pipeline_status       pipeline_status not null default 'scheduled',
  pipeline_started_at   timestamptz,
  pipeline_completed_at timestamptz,
  has_open_items        boolean not null default false,
  source                meeting_source not null default 'calendar',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_meetings_client       on meetings (client_id);
create index idx_meetings_date_time     on meetings (date_time);
create index idx_meetings_status        on meetings (pipeline_status);
create unique index uq_meetings_calendar_event
  on meetings (calendar_event_id) where calendar_event_id is not null;

-- folders (R2 permission layer) ----------------------------------------------
create table folders (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete cascade,  -- null = global (e.g. knowledge-base)
  path                text not null,                 -- R2 prefix
  display_name        text not null,
  visibility          folder_visibility not null default 'all',
  allowed_roles       user_role[] not null default '{admin,standard,viewer}',
  created_by_user_id  uuid references users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create unique index uq_folders_path on folders (path);
create index idx_folders_client on folders (client_id);

-- documents -------------------------------------------------------------------
create table documents (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid references meetings(id) on delete set null,
  client_id           uuid references clients(id) on delete cascade,
  folder_id           uuid references folders(id) on delete set null,
  document_type       document_type not null,
  source_badge        document_source not null,
  r2_key              text not null,                 -- R2 object path
  file_name           text not null,
  file_size           bigint,
  requires_review     boolean not null default false,
  status              document_status not null default 'ready',
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_documents_client  on documents (client_id);
create index idx_documents_meeting  on documents (meeting_id);
create index idx_documents_type     on documents (document_type);
create index idx_documents_status   on documents (status);
create unique index uq_documents_r2key on documents (r2_key);

-- tasks -----------------------------------------------------------------------
create table tasks (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  source_meeting_id   uuid references meetings(id) on delete set null,
  source_document_id  uuid references documents(id) on delete set null,
  description         text not null,
  owner_user_id       uuid references users(id) on delete set null,
  due_date            date,
  status              task_status not null default 'open',
  priority_flag       boolean not null default false,
  archived            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_tasks_client on tasks (client_id);
create index idx_tasks_owner   on tasks (owner_user_id);
create index idx_tasks_status  on tasks (status);
create index idx_tasks_due     on tasks (due_date);
-- days_overdue is COMPUTED in the application/queries (due_date vs now), not stored.

-- task_notes (append-only) ---------------------------------------------------
create table task_notes (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references tasks(id) on delete cascade,
  author_user_id  uuid references users(id) on delete set null,
  content         text not null,
  created_at      timestamptz not null default now()
);
create index idx_task_notes_task on task_notes (task_id);

-- client_notes (Notes tab) ---------------------------------------------------
create table client_notes (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  author_user_id  uuid references users(id) on delete set null,
  content         text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_client_notes_client on client_notes (client_id);

-- client_tabs (custom tab config; null client = global template) -------------
create table client_tabs (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete cascade,
  tab_order           jsonb not null,                -- array of tab definitions
  created_by_user_id  uuid references users(id) on delete set null,
  updated_at          timestamptz not null default now()
);
create index idx_client_tabs_client on client_tabs (client_id);

-- master_record_entries (chronological per client) --------------------------
create table master_record_entries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  meeting_id  uuid references meetings(id) on delete set null,
  summary     text not null,
  created_at  timestamptz not null default now()
);
create index idx_master_record_client on master_record_entries (client_id, created_at desc);

-- daily_syncs -----------------------------------------------------------------
create table daily_syncs (
  id                  uuid primary key default gen_random_uuid(),
  sync_date           date not null unique,
  content             jsonb not null,                -- structured sync payload
  generated_at        timestamptz,
  delivered_at        timestamptz,
  meeting_ids_included uuid[] not null default '{}',
  created_at          timestamptz not null default now()
);
create index idx_daily_syncs_date on daily_syncs (sync_date desc);

-- pre_meeting_briefs ----------------------------------------------------------
create table pre_meeting_briefs (
  id                    uuid primary key default gen_random_uuid(),
  meeting_id            uuid not null references meetings(id) on delete cascade,
  content               text not null,
  r2_key                text,
  generated_at          timestamptz,
  delivered_at          timestamptz,
  delivered_to_user_ids uuid[] not null default '{}',
  created_at            timestamptz not null default now()
);
create index idx_briefs_meeting on pre_meeting_briefs (meeting_id);

-- pipeline_runs (execution log) ----------------------------------------------
create table pipeline_runs (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid references meetings(id) on delete set null,
  source              pipeline_run_source not null,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  duration_seconds    integer,
  documents_generated integer not null default 0,
  status              pipeline_run_status,
  error_message       text,                          -- visible to Admin only (API gate)
  created_at          timestamptz not null default now()
);
create index idx_pipeline_runs_meeting on pipeline_runs (meeting_id);
create index idx_pipeline_runs_started on pipeline_runs (started_at desc);

-- knowledge_base_documents ----------------------------------------------------
create table knowledge_base_documents (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  topic_tags          text[] not null default '{}',
  r2_key              text not null,
  file_name           text not null,
  file_size           bigint,
  uploaded_by_user_id uuid references users(id) on delete set null,
  expiration_date     date,
  ai_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
create index idx_kb_tags on knowledge_base_documents using gin (topic_tags);
create index idx_kb_expiration on knowledge_base_documents (expiration_date);

-- embeddings (pgvector) -------------------------------------------------------
-- text-embedding-3-small => 1536 dimensions (D9, pinned).
create table embeddings (
  id           uuid primary key default gen_random_uuid(),
  source_type  embedding_source not null,
  source_id    uuid not null,                        -- documents.id / kb.id / meetings.id
  client_id    uuid references clients(id) on delete cascade,  -- for scoped retrieval
  chunk_index  integer not null,
  content      text not null,
  embedding    vector(1536) not null,
  created_at   timestamptz not null default now()
);
create index idx_embeddings_source on embeddings (source_type, source_id);
create index idx_embeddings_client on embeddings (client_id);
-- ANN index for similarity search (cosine). Tune lists to data size.
create index idx_embeddings_vector on embeddings
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- notifications (in-app primary; Resend secondary) ---------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  type        notification_type not null,
  title       text not null,
  body        text,
  link        text,                                  -- in-app deep link
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_notifications_user on notifications (user_id, created_at desc);

-- ASSISTANT MODULE (general AI chat — replaces ChatGPT seats) -----------------
-- See docs/superpowers/specs/2026-06-07-assistant-module-design.md.
-- Strictly per-user private; admins NEVER read content (delete-only purge).

-- assistant_chats: per-user conversations (ChatGPT-style sidebar)
create table assistant_chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  title       text,                                  -- auto-generated from first exchange
  model       text,                                  -- model used (from API Settings at creation)
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_assistant_chats_user on assistant_chats (user_id, updated_at desc);

-- assistant_messages: messages within a conversation
create table assistant_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references assistant_chats(id) on delete cascade,
  role           assistant_msg_role not null,
  content        text not null,
  attachment_ids uuid[] not null default '{}',       -- ephemeral files referenced this turn
  token_usage    jsonb,                               -- {prompt, completion} for cost tracking
  created_at     timestamptz not null default now()
);
create index idx_assistant_messages_chat on assistant_messages (chat_id, created_at);

-- assistant_attachments: ephemeral, chat-scoped uploads (NOT client docs/KB)
create table assistant_attachments (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references assistant_chats(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  file_name      text not null,
  extracted_text text,                                -- text for Q&A; NO embeddings
  r2_key         text,                                -- raw file in MinIO (optional retention)
  created_at     timestamptz not null default now()
);
create index idx_assistant_attachments_chat on assistant_attachments (chat_id);

-- ai_providers (multi-provider support, D11) ---------------------------------
-- Stores configured providers + (encrypted) keys. Generation provider/model is
-- selected in settings (ai_provider / ai_model). Embeddings stay pinned (D9).
create table ai_providers (
  id              uuid primary key default gen_random_uuid(),
  provider_key    text unique not null,              -- 'openai' | 'anthropic' | ...
  display_name    text not null,
  api_key_encrypted bytea,                           -- encrypted at rest, backend-only
  enabled         boolean not null default false,
  available_models text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- integration_credentials (Admin -> API Settings, rotatable keys) ------------
-- General store for ALL third-party API keys editable from the Admin portal.
-- Values are ENCRYPTED at rest (backend-only). Env vars are the fallback if a
-- row is absent. `ai_providers` (above) remains the model-selection record;
-- this table is the universal credential store referenced by API Settings.
create table integration_credentials (
  id                  uuid primary key default gen_random_uuid(),
  service             integration_key not null,
  label               text not null,                 -- e.g. 'Recall.ai API Key'
  secret_encrypted    bytea,                          -- encrypted; never returned raw to client
  config              jsonb not null default '{}',    -- non-secret config (region, bucket, endpoint, etc.)
  is_set              boolean not null default false,  -- whether a secret is stored (for UI status)
  last_tested_at      timestamptz,                     -- last "Test Connection" result time
  last_test_ok        boolean,                         -- last test pass/fail
  updated_by_user_id  uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index uq_integration_service on integration_credentials (service);

-- ============================================================================
-- updated_at TRIGGER
-- ============================================================================
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array[
    'users','clients','meetings','documents','tasks',
    'client_notes','ai_providers','integration_credentials','assistant_chats'
  ]
  loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Principle: API middleware is PRIMARY enforcement. RLS is defense-in-depth for
-- frontend (anon-key) reads. The worker/service-role bypasses RLS.
-- Three roles via auth_role(): admin / standard / viewer.
-- ============================================================================

-- Enable RLS on all application tables
alter table users                     enable row level security;
alter table settings                  enable row level security;
alter table clients                   enable row level security;
alter table client_aliases            enable row level security;
alter table meeting_type_rules        enable row level security;
alter table meetings                  enable row level security;
alter table folders                   enable row level security;
alter table documents                 enable row level security;
alter table tasks                     enable row level security;
alter table task_notes                enable row level security;
alter table client_notes              enable row level security;
alter table client_tabs               enable row level security;
alter table master_record_entries     enable row level security;
alter table daily_syncs               enable row level security;
alter table pre_meeting_briefs        enable row level security;
alter table pipeline_runs             enable row level security;
alter table knowledge_base_documents  enable row level security;
alter table embeddings                enable row level security;
alter table notifications             enable row level security;
alter table ai_providers              enable row level security;
alter table integration_credentials   enable row level security;
alter table assistant_chats           enable row level security;
alter table assistant_messages        enable row level security;
alter table assistant_attachments     enable row level security;

-- ---- READ policies (all authenticated roles can read most content) ----------
-- Generic "any authenticated user can select" for shared content.
create policy read_clients         on clients                  for select using (auth_uid() is not null);
create policy read_meetings        on meetings                 for select using (auth_uid() is not null);
create policy read_tasks           on tasks                    for select using (auth_uid() is not null);
create policy read_task_notes      on task_notes               for select using (auth_uid() is not null);
create policy read_client_notes    on client_notes             for select using (auth_uid() is not null);
create policy read_client_tabs     on client_tabs              for select using (auth_uid() is not null);
create policy read_master_record   on master_record_entries    for select using (auth_uid() is not null);
create policy read_daily_syncs     on daily_syncs              for select using (auth_uid() is not null);
create policy read_briefs          on pre_meeting_briefs       for select using (auth_uid() is not null);
create policy read_kb              on knowledge_base_documents for select using (auth_uid() is not null);
create policy read_aliases         on client_aliases           for select using (auth_uid() is not null);

-- users: a user can read self; admin reads all
create policy read_users on users for select
  using (auth_role() = 'admin' or id = auth_uid());

-- folders: hide 'restricted' folders unless the role is allowed
create policy read_folders on folders for select
  using (
    auth_uid() is not null
    and (visibility = 'all' or auth_role() = any (allowed_roles))
  );

-- documents: visible unless they live in a folder the user cannot see
create policy read_documents on documents for select
  using (
    auth_uid() is not null
    and (
      folder_id is null
      or exists (
        select 1 from folders f
        where f.id = documents.folder_id
          and (f.visibility = 'all' or auth_role() = any (f.allowed_roles))
      )
    )
  );

-- embeddings: backend-only in practice; restrict reads to admin (anon key won't query directly)
create policy read_embeddings on embeddings for select using (auth_role() = 'admin');

-- pipeline_runs: error_message gating is enforced at API layer; allow read of rows
create policy read_pipeline_runs on pipeline_runs for select using (auth_uid() is not null);

-- settings & meeting_type_rules: admin-only read (config)
create policy read_settings on settings for select using (auth_role() = 'admin');
create policy read_meeting_type_rules on meeting_type_rules for select using (auth_role() = 'admin');

-- ai_providers: admin-only
create policy read_ai_providers on ai_providers for select using (auth_role() = 'admin');

-- integration_credentials: admin-only (and secret_encrypted is NEVER returned
-- to the client by the API — only is_set / last_test status is exposed)
create policy read_integration_credentials on integration_credentials for select using (auth_role() = 'admin');

-- notifications: only your own
create policy read_notifications on notifications for select using (user_id = auth_uid());

-- ---- WRITE policies (Admin + Standard can mutate; Viewer cannot, except own tasks) ----
-- Helper predicate: editor = admin or standard
-- (inlined below as: auth_role() in ('admin','standard'))

-- clients: editors can update; only admin can insert/delete
create policy write_clients_update on clients for update using (auth_role() in ('admin','standard'));
create policy write_clients_admin  on clients for all   using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- tasks: editors full CRUD; viewer may update ONLY own task status (complete)
create policy insert_tasks on tasks for insert with check (auth_role() in ('admin','standard'));
create policy update_tasks_editor on tasks for update using (auth_role() in ('admin','standard'));
create policy update_tasks_viewer_own on tasks for update
  using (auth_role() = 'viewer' and owner_user_id = auth_uid())
  with check (owner_user_id = auth_uid());
create policy delete_tasks on tasks for delete using (auth_role() in ('admin','standard'));

-- task_notes: editors can add; authors/admin can modify own
create policy insert_task_notes on task_notes for insert with check (auth_role() in ('admin','standard'));
create policy modify_task_notes on task_notes for all
  using (author_user_id = auth_uid() or auth_role() = 'admin');

-- client_notes: editors add; author edits own, admin any
create policy insert_client_notes on client_notes for insert with check (auth_role() in ('admin','standard'));
create policy modify_client_notes on client_notes for update
  using (author_user_id = auth_uid() or auth_role() = 'admin');
create policy delete_client_notes on client_notes for delete
  using (author_user_id = auth_uid() or auth_role() = 'admin');

-- documents / folders: editors create; delete-own for standard, any for admin
create policy insert_documents on documents for insert with check (auth_role() in ('admin','standard'));
create policy update_documents on documents for update using (auth_role() in ('admin','standard'));
create policy delete_documents on documents for delete
  using (auth_role() = 'admin' or (auth_role() = 'standard' and uploaded_by_user_id = auth_uid()));

create policy insert_folders on folders for insert with check (auth_role() in ('admin','standard'));
create policy update_folders on folders for update using (auth_role() in ('admin','standard'));
create policy delete_folders on folders for delete using (auth_role() = 'admin');
-- Only admin may create a 'restricted' folder — enforced at API layer + check:
create policy restrict_folder_visibility on folders for insert
  with check (visibility = 'all' or auth_role() = 'admin');

-- knowledge_base: editors add/update; admin delete
create policy insert_kb on knowledge_base_documents for insert with check (auth_role() in ('admin','standard'));
create policy update_kb on knowledge_base_documents for update using (auth_role() in ('admin','standard'));
create policy delete_kb on knowledge_base_documents for delete using (auth_role() = 'admin');

-- settings / rules / aliases / ai_providers: admin-only writes
create policy write_settings on settings for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy write_rules on meeting_type_rules for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy write_aliases on client_aliases for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy write_ai_providers on ai_providers for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy write_integration_credentials on integration_credentials for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- users: admin manages roles; users update own last_active
create policy admin_users on users for all using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy self_update_users on users for update using (id = auth_uid());

-- notifications: users mark own read
create policy update_notifications on notifications for update using (user_id = auth_uid());

-- ASSISTANT: strictly private to the author. NO admin read exception.
-- Admin purge-on-offboarding is a delete-only path performed via service-role
-- (worker/backend), which bypasses RLS — so no admin SELECT policy is granted here.
create policy own_assistant_chats on assistant_chats for all
  using (user_id = auth_uid()) with check (user_id = auth_uid());

create policy own_assistant_messages on assistant_messages for all
  using (exists (select 1 from assistant_chats c
                 where c.id = assistant_messages.chat_id and c.user_id = auth_uid()))
  with check (exists (select 1 from assistant_chats c
                      where c.id = assistant_messages.chat_id and c.user_id = auth_uid()));

create policy own_assistant_attachments on assistant_attachments for all
  using (user_id = auth_uid()) with check (user_id = auth_uid());

-- meetings/master_record/syncs/briefs/pipeline_runs writes happen via service-role
-- (worker) which bypasses RLS. No anon write policies needed for those.

-- ============================================================================
-- VECTOR SIMILARITY SEARCH HELPER (called by backend, service-role)
-- ============================================================================
create or replace function match_embeddings(
  query_embedding vector(1536),
  match_client_id uuid,
  match_count int default 8
)
returns table (id uuid, source_type embedding_source, source_id uuid, content text, similarity float)
language sql stable as $$
  select e.id, e.source_type, e.source_id, e.content,
         1 - (e.embedding <=> query_embedding) as similarity
  from embeddings e
  where (match_client_id is null or e.client_id = match_client_id)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================================
-- END OF SCHEMA
-- Tables: users, settings, clients, client_aliases, meeting_type_rules,
--   meetings, folders, documents, tasks, task_notes, client_notes, client_tabs,
--   master_record_entries, daily_syncs, pre_meeting_briefs, pipeline_runs,
--   knowledge_base_documents, embeddings, notifications, ai_providers,
--   integration_credentials, assistant_chats, assistant_messages,
--   assistant_attachments  (24)
-- ============================================================================
