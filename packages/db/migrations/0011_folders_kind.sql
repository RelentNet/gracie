-- 0011_folders_kind.sql — GF (Gracie Files): staff/team working drive on MinIO.
--
-- Adds a single additive discriminator to `folders` so the SAME documents/folders/
-- ingest/retrieval stack can carry a staff working-drive alongside client documents:
--
--   * folders.kind text not null default 'client' — 'client' (the existing per-client
--     document folders, incl. the internal Grace & Associates org's generated docs) or
--     'staff' (the shared Gracie Files drive, rooted at the `staff/` object-key prefix
--     and owned by the internal GA org's client_id). Existing rows backfill to 'client'
--     via the default, so nothing in the client Documents views changes.
--
-- This is a PLAIN text column (app-validated), NOT a Postgres enum — mirroring how
-- `automations.type` (0009/0010) is modelled — so there is no ALTER TYPE and no enum to
-- keep in lockstep. The staff drive flows through the existing client-scoped ingest
-- (embeddings.client_id = the internal org) and the company-aware Assistant's
-- `match_all_embeddings` retrieval with zero new ingest lane, RPC, or embedding_source.
--
-- A partial index accelerates the staff-tree listing (a small slice of `folders`).
--
-- Additive + idempotent (IF NOT EXISTS). Depends on the base `folders` table.
-- Applies to the SHARED dev+prod Supabase — apply ONLY in coordination with the
-- orchestrator (do NOT apply from this build session).

-- 1. The client|staff discriminator. Default 'client' backfills every existing row. ----
alter table folders
  add column if not exists kind text not null default 'client';

-- 2. Speeds `where kind = 'staff'` staff-drive listings (indexes only the staff slice). -
create index if not exists idx_folders_kind_staff
  on folders (kind)
  where kind = 'staff';
