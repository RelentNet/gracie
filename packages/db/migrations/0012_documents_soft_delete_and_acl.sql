-- 0012_documents_soft_delete_and_acl.sql — Documents management: recycle bin + real per-role ACL.
--
-- Backs three user-facing capabilities that the Documents area never had: rename,
-- change permissions, and delete. Delete is SOFT — an item moves to a recycle bin,
-- stays there for a retention window (default 60 days), is neither viewable nor
-- downloadable while there, and can be restored. A worker sweep purges past the
-- window (kill-switched OFF at ship time).
--
-- Additive + idempotent (IF NOT EXISTS). No column is dropped or retyped, and NO
-- r2_key/path is rewritten — rename is metadata-only by design (`folders.path` and
-- `documents.r2_key` remain the storage identities; only the display columns change).
-- Applies to the SHARED dev+prod Supabase — apply ONLY in coordination with the
-- orchestrator. Hand-update packages/db/src/database.types.ts (done in this change).

-- ---------------------------------------------------------------------------
-- 1. Soft delete
-- ---------------------------------------------------------------------------
-- `delete_batch_id` groups one recursive folder delete (the folder, its descendant
-- folders, and every document inside them) so Restore brings the subtree back as a
-- unit instead of stranding children in the bin.

alter table documents add column if not exists deleted_at timestamptz;
alter table documents add column if not exists deleted_by_user_id uuid references users(id) on delete set null;
alter table documents add column if not exists delete_batch_id uuid;

alter table folders add column if not exists deleted_at timestamptz;
alter table folders add column if not exists deleted_by_user_id uuid references users(id) on delete set null;
alter table folders add column if not exists delete_batch_id uuid;

-- ---------------------------------------------------------------------------
-- 2. Per-file permission override
-- ---------------------------------------------------------------------------
-- NULL on BOTH columns = inherit the governing folder's permissions (the default,
-- and what every existing row does). Non-NULL = this file overrides its folder.
-- Reuses the existing folder_visibility / user_role enums — no new types.
--
-- The folder remains a CEILING: an override can lock a file DOWN inside an open
-- folder, but can never open a file UP inside a folder the user cannot see. That
-- rule lives in the resolver (packages/shared/src/permissions/visibility.ts), not
-- in a constraint, because it depends on the requesting role.

alter table documents add column if not exists visibility folder_visibility;
alter table documents add column if not exists allowed_roles user_role[];

-- ---------------------------------------------------------------------------
-- 3. folders.updated_at
-- ---------------------------------------------------------------------------
-- `folders` was the one mutable table without it (rename/permission edits now make
-- it meaningful). Attach the same set_updated_at() trigger the other tables use.

alter table folders add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_folders_updated') then
    execute 'create trigger trg_folders_updated before update on folders
             for each row execute function set_updated_at()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
-- Partial on `deleted_at is not null`: the bin is small and queried directly, while
-- every normal listing filters `deleted_at is null` (the large majority) and is
-- already served by the existing client/folder indexes.

create index if not exists idx_documents_deleted on documents (deleted_at) where deleted_at is not null;
create index if not exists idx_folders_deleted   on folders   (deleted_at) where deleted_at is not null;
create index if not exists idx_documents_batch   on documents (delete_batch_id) where delete_batch_id is not null;
create index if not exists idx_folders_batch     on folders   (delete_batch_id) where delete_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 5. ⚠️ REQUIRED BACKFILL — preserve today's effective access
-- ---------------------------------------------------------------------------
-- `folders.allowed_roles` has existed since the base schema but is DEAD CODE: every
-- consumer collapses it to "restricted ⇒ admin only" (it is only ever tested for
-- 'admin'). So a restricted folder sitting on the default '{admin,standard,viewer}'
-- is, today, admin-only in practice.
--
-- This change makes the column authoritative. Without this backfill, every existing
-- restricted folder would WIDEN from admin-only to everyone the moment the new
-- resolver ships — including the auto-created per-client `transcripts` folders, which
-- are created restricted. That is a silent access regression, so the migration
-- normalizes those rows to what they already effectively mean.
--
-- Scoped to rows still on the untouched default: a folder whose allowed_roles was
-- deliberately set to something else is left alone.

update folders
   set allowed_roles = '{admin}'::user_role[]
 where visibility = 'restricted'
   and allowed_roles = '{admin,standard,viewer}'::user_role[];

-- ---------------------------------------------------------------------------
-- 6. Settings (DATA)
-- ---------------------------------------------------------------------------
-- Same storage format as 0004/0005 + the P7 seed: jsonb-encoded scalar strings.
-- Non-clobbering so re-applying never overwrites an operator-tuned value.

-- Retention window before a soft-deleted item is purged for real.
insert into settings (key, value)
values ('documents_trash_retention_days', to_jsonb('60'::text))
on conflict (key) do nothing;

-- ⚠️ KILL-SWITCH — ships OFF. Purge is the only IRREVERSIBLE step in this feature.
-- With this false the nightly sweep still runs and logs exactly what it WOULD purge,
-- but destroys nothing. Flip to 'true' only after restore has been verified in prod.
insert into settings (key, value)
values ('documents_trash_purge_enabled', to_jsonb('false'::text))
on conflict (key) do nothing;
