# Documents — Rename / Permissions / Delete + 60-Day Recycle Bin

**Type:** Bug fix + feature gap · **Branch:** `fix/documents-manage-recycle-bin` · **Deliverable:** one PR to `main`

---

## 0. Prior art, and the one thing to avoid

An earlier attempt at Documents file management (`docs/plan/documents-file-management.md`) built and
then reverted several pieces of this — file delete, recursive folder delete, folder rename, uploader
attribution. That work is useful reference and is fine to draw on.

What was deferred to V2 is a **different** thing: *"Gracie Files," the local desktop sync agent* — a
Dropbox/OneDrive-style client that mounts the MinIO objects on a Mac/Windows machine. That is
infrastructure, not app code, and it is entirely out of scope here. Nothing in this brief touches it.

The one thing **not** to inherit is the "separate parallel staff drive" framing from
`docs/plan/gracie-files.md`: a `staff/` root, a `folders.kind` column, its own nav entry, hidden from
the Documents tree. That was explicitly rejected. Everything in this brief lives inside the existing
Documents area, operating on the existing `folders` / `documents` tables.

---

## 1. The problem

The Documents area is read-mostly. Users can upload, download, and move — but there is **no way to
delete anything, rename anything, or change who can see it.** Once a file or folder is created it is
permanent and its permissions are frozen at creation time.

Concretely, today:

- `FileList.tsx:105-121` — the Actions cell has exactly two buttons: Download and Move.
- `FolderTree.tsx` — folder nodes have no actions at all. No context menu, no kebab, nothing.
- There is **no `DELETE` route** for `documents` or `folders` anywhere in `apps/web/app/api/`.
- There is no `PATCH` route for either.
- Folder permissions can only be set at creation (`restricted` checkbox in `NewFolderModal`), never changed.
- Files have no permissions of their own at all.

## 2. What to build

Every folder **and** every file gets three actions: **Rename**, **Permissions**, **Delete**.
Delete is soft — it moves the item to a **Recycle Bin** where it sits for 60 days, is **not
viewable or downloadable**, and can be **restored**. After 60 days a worker sweep purges it for real.

---

## 3. Key design facts (verified against current code — trust these)

### 3.1 Rename is metadata-only. Do not touch storage.

`folders.display_name` is a separate column from `folders.path`, and `documents.file_name` is
separate from `documents.r2_key`. **Renaming must update only the display column.** Never rewrite
`path`, never rewrite `r2_key`, never copy or move an S3 object during a rename.

This matters because `folders.path` is the folder's real identity: it is `UNIQUE`, it is what
`canAccessKey()` authorizes against, and the folder *tree itself* is reconstructed purely from
string prefixes of `path` (`components/FileBrowser/tree.ts:51-86` — there is no `parent_folder_id`).
Rewriting a path would silently reparent every descendant and orphan every object key beneath it.

### 3.2 `folders.allowed_roles` already exists but is dead code

The schema has `folders.allowed_roles user_role[]` — a genuine per-folder role list. But every
consumer collapses it to a binary "restricted ⇒ admin only":

- `apps/web/lib/data/documents.ts:133-136` — `isVisibleToRole` returns `isAdmin && folder.allowedRoles.includes('admin')`. The array is only ever tested for `'admin'`.
- `apps/web/lib/data/files.ts:39-41` — same reduction inside `canAccessKey`.
- `apps/web/components/FileBrowser/DriveBrowser.tsx:126` — client mirror drops the array entirely: `folder.visibility !== 'restricted' || isAdmin`.

So a folder with `allowed_roles = {admin,standard}` is today still hidden from `standard`. **Part of
this work is making that column real** (§5.1).

### 3.3 The delete permissions already exist in the matrix and are unused

`packages/shared/src/constants/permissions.ts` already defines `file.deleteOwn`,
`file.deleteAny`, `folder.delete`, `folder.manage`, `folder.viewRestricted` — with sensible role
mappings — and **zero call sites reference them.** Wire these up rather than inventing new strings.

Note the naming convention is singular-dotted: `'document.view'`, `'file.upload'` — *not* `'documents.view'`.

### 3.4 Server-side authorization does not use the permission matrix

Two parallel systems exist. Client-side uses `can(role, permission)` via `lib/auth.tsx:44`.
Server-side ignores it and uses ad-hoc helpers: `isAdmin`/`isEditor` from `lib/api-auth.ts:66,71`
and `canEditRole` from `lib/data/files.ts:11-13`.

**For the new routes, use `can()` on the server too.** Import it from `@gracie/shared` and gate on
the real permission strings. Do not add more ad-hoc role literals. Leave the existing routes'
helpers alone (out of scope) — just don't extend the pattern.

### 3.5 RLS is not your enforcement layer

`docs/04-database-schema.sql:509-631` defines RLS policies including `delete_documents` and
`delete_folders`, but **all app code uses `getServerClient()` (service-role), which bypasses RLS
entirely.** Enforce in the route handlers. Optionally update the RLS policies to match for
defense-in-depth, but do not rely on them.

### 3.6 `documents.uploaded_by_user_id` is not populated on upload

It is defined but `apps/web/app/api/upload/route.ts` never sets it. **Fix this as part of this PR**
— "delete your own file" is unimplementable without it. Backfill is not required; pre-existing rows
keep NULL and are treated as admin-only-deletable.

### 3.7 Pre-existing prefix-collision bug in `canAccessKey` — fix it

`apps/web/lib/data/files.ts:32` matches with `key.startsWith(f.path)` with no trailing-slash
boundary. So a restricted folder at `clients/acme/transcripts` also governs
`clients/acme/transcripts-public/...`, and the "longest matching folder wins" rule can select the
wrong folder entirely. The same class of bug is in `tree.ts:62` parent derivation.

**Fix both** (`key === f.path || key.startsWith(f.path + '/')`). Delete and permission
authorization inherit this function, so shipping delete on top of the bug would let it decide who
can destroy data.

### 3.8 `embeddings` has no FK to `documents`

`embeddings.source_id` is a polymorphic soft reference with **no foreign key** — nothing cascades.
See §5.4 for how deleted documents must be kept out of AI retrieval.

---

## 4. Migration `0012_documents_soft_delete_and_acl.sql`

Next migration number is **0012** (`0011_meetings_series_id.sql` is the current highest and is
applied). Migrations are applied **manually** — there is no runner. Write it idempotently
(`if not exists` / `if exists`) in the style of the existing files.

```sql
-- documents: soft delete
alter table documents add column if not exists deleted_at timestamptz;
alter table documents add column if not exists deleted_by_user_id uuid references users(id) on delete set null;
alter table documents add column if not exists delete_batch_id uuid;

-- documents: per-file permission override (NULL on both = inherit from governing folder)
alter table documents add column if not exists visibility folder_visibility;
alter table documents add column if not exists allowed_roles user_role[];

-- folders: soft delete
alter table folders add column if not exists deleted_at timestamptz;
alter table folders add column if not exists deleted_by_user_id uuid references users(id) on delete set null;
alter table folders add column if not exists delete_batch_id uuid;

-- folders has no updated_at today; add it and attach the existing trigger
alter table folders add column if not exists updated_at timestamptz not null default now();
-- (attach set_updated_at() to folders, matching the trigger loop at docs/04-database-schema.sql:481-493)

-- indexes
create index if not exists idx_documents_deleted on documents(deleted_at) where deleted_at is not null;
create index if not exists idx_folders_deleted   on folders(deleted_at)   where deleted_at is not null;
create index if not exists idx_documents_batch   on documents(delete_batch_id) where delete_batch_id is not null;
create index if not exists idx_folders_batch     on folders(delete_batch_id)   where delete_batch_id is not null;
```

Reuse the **existing** `folder_visibility` and `user_role` enums — do not create new types.

**Required backfill — do not skip.** `folders.allowed_roles` defaults to `{admin,standard,viewer}`,
and today that value is ignored (every `restricted` folder is admin-only in practice). The moment
§5.1 makes the column real, any existing restricted folder still sitting on that default would widen
to everyone. Auto-created `transcripts` folders are restricted, so this is not hypothetical. The
migration must therefore preserve today's effective behaviour:

```sql
update folders set allowed_roles = '{admin}'::user_role[]
where visibility = 'restricted' and allowed_roles = '{admin,standard,viewer}'::user_role[];
```

**Retention setting:** seed `documents_trash_retention_days` = `60` into `settings` following the
existing settings-seed pattern (see `packages/db/seeds/p7_settings.sql`). The purge sweep reads it
so retention is tunable without a deploy.

**Regenerate `packages/db/src/database.types.ts` by hand** (there is no `supabase` CLI in this repo —
prior phases hand-edited it; follow suit). `documents` is at line 776, `folders` at line 892.

**Flag the migration in your PR description as UNAPPLIED.** The orchestrator applies it; do not
attempt to apply it yourself.

---

## 5. Behaviour spec

### 5.1 Permission model (make `allowed_roles` real)

Replace the "restricted ⇒ admin only" reduction with a true role-list check. Effective visibility of
a **folder** for a user with role `r`:

```
visible = folder.visibility === 'all'
       || folder.allowed_roles.includes(r)
       || can(r, 'folder.viewRestricted')      // admin-only — admins always see
```

Effective visibility of a **document**: if `document.visibility` is non-NULL, evaluate the same rule
against the document's own `visibility`/`allowed_roles`. If NULL, inherit the governing folder's
result. A file can therefore be locked down inside an open folder, and a file in a restricted folder
can *not* be opened up by override — **the folder is a ceiling**: if the user cannot see the folder,
they cannot see the file regardless of override. Enforce that ceiling explicitly.

Apply this consistently in **all three** places listed in §3.2 — server truth in
`lib/data/documents.ts` and `lib/data/files.ts`, client mirror in `DriveBrowser.tsx` (which must
stop dropping `allowedRoles`).

**Who may change permissions:** `folder.manage` for folders (admin + standard),
`folder.manage` for file overrides too. But a non-admin must not be able to grant access to a role
they cannot themselves see, nor remove their own access — simplest correct rule: **only admins may
set or clear a `restricted` visibility.** Standard users may rename and may edit permissions only
among already-permitted roles. Mirror the existing precedent at `api/folders/route.ts:70`, where
creating a restricted folder already requires `isAdmin`.

### 5.2 Delete (soft)

| Target | Permission | Effect |
|---|---|---|
| File you uploaded | `file.deleteOwn` (admin + standard) | soft delete |
| Any file | `file.deleteAny` (admin) | soft delete |
| Folder | `folder.delete` (admin) | recursive soft delete |

"You uploaded" = `documents.uploaded_by_user_id === caller's internal user id`. **Use the internal
`users.id` uuid, not the Logto id** — this exact confusion caused a production 500 in P9; there is a
`getUserIdByLogtoId` helper for it.

Soft delete sets `deleted_at = now()`, `deleted_by_user_id`, and a `delete_batch_id`.

**Folder delete is recursive and atomic-ish:** generate one `delete_batch_id` (uuid) and stamp it on
the folder, every descendant folder (matched by `path = f.path OR path LIKE f.path || '/%'`), and
every document in any of them. The shared batch id is what makes restore bring the whole subtree
back as a unit. Do the whole cascade in a single transaction/RPC where possible; if the Supabase
client makes that awkward, stamp folders first then documents, and make restore tolerant of a
partial batch.

**Nothing is deleted from S3 on soft delete.** Objects stay put until purge.

### 5.3 The Recycle Bin

**Access:** admins see every deleted item. Standard users see only items where
`deleted_by_user_id = their user id`. Viewers see no bin at all (no nav entry, and the API returns
403). Restricted-folder filtering still applies on top of this for admins-only content.

**Hard rule — deleted items are inert.** While `deleted_at` is set, the item must not be viewable,
downloadable, movable, renameable, or re-permissioned. Enforce this at the API, not just the UI:

- `GET /api/files/url` — **must 404/403 if the key belongs to a soft-deleted document, for both `get` and `put`.** This is the single most important gate; the presign endpoint is the only path to bytes.
- `GET /api/documents` and `GET /api/folders` — exclude `deleted_at is not null` from all normal listings.
- `POST /api/documents/move` and the rename/permission PATCHes — reject deleted targets.
- Upload into a deleted folder — reject.

To view or download, the user must **Restore** first. That is the intended friction; do not add a
"peek" or "preview from bin" affordance.

**Restore:**
- Restoring a **folder** restores its whole `delete_batch_id` set.
- Restoring a **file** whose governing folder is still deleted must also restore the ancestor folder chain (otherwise the file returns to an invisible location). Restore ancestors, not the whole batch.
- Restore clears `deleted_at`, `deleted_by_user_id`, `delete_batch_id`.
- Permission to restore = permission to have deleted it.

**Display:** the bin lists both folders and files, with a "Deleted" date, "Deleted by", and a
**"Purges in N days"** column computed from `deleted_at + retention`. Sort soonest-purge first.

### 5.4 Keep deleted documents out of AI retrieval

`embeddings.source_id` has no FK, so a soft-deleted document would keep answering assistant queries —
a real confidentiality leak, since "delete" implies "gone."

**On soft delete: delete the `embeddings` rows for that document (`source_id = document.id`).**
**On restore: re-enqueue the document for ingestion** using the same enqueue path
`/api/upload` uses. This keeps the retrieval query untouched and makes the leak structurally
impossible rather than filter-dependent. Follow the precedent in
`apps/web/lib/data/knowledge-base.ts` (`deleteKnowledgeBaseDocument`), which already handles
embeddings cleanup explicitly.

### 5.5 Purge sweep (worker)

Add a **nightly** sweep to `apps/worker` following the existing nightly-sweep pattern (the contacts
suggestions sweep is the closest model).

For every document with `deleted_at < now() - (retention days)`:
1. `deleteObject(r2_key)` — **best-effort, wrapped in try/catch.** A missing object must not abort the sweep or 500; log and continue. (Precedent: `api/knowledge-base/[id]/route.ts:116-120`.)
2. Delete the `documents` row.
3. Delete any lingering `embeddings` where `source_id = id`.

Then delete expired `folders` rows that contain no remaining documents.

**Gate the whole sweep behind a settings kill-switch** (`documents_trash_purge_enabled`, seeded
**`'false'`**) matching this project's convention. Purge is the only irreversible step in this
feature and it must ship OFF, so the operator can watch the bin fill and verify restore works before
anything is destroyed. Log a dry-run summary (what *would* be purged) on every run regardless of the
switch.

---

## 6. API surface

All routes: resolve the caller with `getRequestUser()`, gate with `can()`, and set
`export const runtime = 'nodejs'` on anything that touches `@gracie/shared/storage`.

| Route | Method | Body / query | Gate |
|---|---|---|---|
| `/api/documents/[id]` | `PATCH` | `{ fileName?, visibility?, allowedRoles? }` | `folder.manage`; restricted requires admin |
| `/api/documents/[id]` | `DELETE` | — | `file.deleteOwn` (if uploader) or `file.deleteAny` |
| `/api/documents/[id]/restore` | `POST` | — | same as delete |
| `/api/folders/[id]` | `PATCH` | `{ displayName?, visibility?, allowedRoles? }` | `folder.manage`; restricted requires admin |
| `/api/folders/[id]` | `DELETE` | — | `folder.delete` (admin) |
| `/api/folders/[id]/restore` | `POST` | — | `folder.delete` |
| `/api/documents/trash` | `GET` | `?clientId=` optional | admin sees all; standard sees own; viewer 403 |

Every route must also run the existing `canAccessKey`-style folder-visibility check on the target —
a user who cannot see a folder must not be able to rename, re-permission, or delete it, and must get
the same 404 they'd get for a nonexistent id (do not leak existence).

---

## 7. UI

All work is in `apps/web/components/FileBrowser/`.

**`FileList.tsx`** — extend the Actions cell (`:105-121`). It already has a `FileAction` button
primitive at `:131-156`; reuse it. Add **Rename**, **Permissions**, **Delete** (trash icon,
destructive styling), each gated by the matching `can()` check from `useAuth()`. Keep Download and
Move as-is.

**`FolderTree.tsx`** — folder nodes currently have no actions. Add a kebab (⋯) menu that appears on
hover/focus per node with the same three actions. **Only on real folder nodes** — the tree also
contains sentinel nodes (`ALL_FILES_KEY`, `ALL_CLIENTS_KEY`, `RECENT_KEY`, `KB_KEY`, and
`client:`-prefixed org nodes, see `tree.ts:33-39`) which must have no actions. Keep it keyboard-accessible.

**New components:**
- `RenameModal.tsx` — single text field, prefilled, submit disabled when unchanged/empty.
- `PermissionsModal.tsx` — Admin / Standard / Viewer checkboxes. For files, a radio pair: *Inherit from folder "X"* (shows the resolved inherited state, read-only) vs *Override for this file* (enables the checkboxes). Admin checkbox is always on and disabled — you cannot lock admins out. Non-admins: the restricted controls are visible but disabled with a "Admins only" hint.
- `ConfirmDeleteDialog.tsx` — states what is being deleted; for folders, states the recursive count ("This folder and 12 files"); says it goes to the Recycle Bin and is recoverable for 60 days. Not a `window.confirm`.

**Recycle Bin view** — add a `TRASH_KEY` sentinel node pinned at the bottom of the tree (hidden for
viewers). Selecting it renders the deleted list with a single **Restore** action per row and the
purge countdown column. Download/Move/Open must be **absent**, not merely disabled-looking.

Follow the existing modal convention in `DriveBrowser.tsx:344-382` — modals are mounted only while
open so form state re-initializes. Reuse the `refreshNonce` pattern (`:86,:95`) to reload after
every mutation.

Both entry points must work: the global page (`app/(app)/documents/page.tsx`) and the per-client tab
(`app/(app)/clients/[clientId]/documents/page.tsx`). Both render the same `DriveBrowser`, so this
should be automatic — verify it, don't assume.

---

## 8. Testing

- **Unit:** the new effective-visibility resolver (folder rule, file override, folder-as-ceiling, admin-always-sees) and the `canAccessKey` trailing-slash fix — include the `transcripts` vs `transcripts-public` collision case as an explicit regression test.
- **Unit:** recursive folder-delete descendant matching, including the same prefix-boundary trap.
- **Worker:** purge sweep — respects retention, respects the kill-switch, survives a missing S3 object.
- **Manual, must verify before opening the PR:**
  1. Delete a file → gone from the list, present in the bin.
  2. Grab its presigned URL *before* deleting, then retry it after → **must fail.** (This is the leak test.)
  3. Restore → reappears, downloads fine.
  4. Delete a folder with nested subfolders and files → whole subtree in the bin; restore brings it all back.
  5. Rename a folder → objects still download (proves you did not touch `path`).
  6. Set a folder to admin+standard → a viewer cannot see it, a standard user can. (This is the case that is *impossible* today.)
  7. Override a single file to admin-only inside an open folder → standard user sees the folder but not the file.
  8. Standard user cannot delete another user's upload; can delete their own.
  9. Viewer sees no bin, no action buttons.
  10. Ask the assistant about a deleted document's contents → it must not know.

Run the project's green gate (typecheck + lint + tests) before opening the PR.

---

## 9. Out of scope — do not build

- "Delete permanently now" / "Empty bin" buttons. Purge is time-based only, for now.
- Multi-select / bulk actions. Selection is single-node (`selectedKey: string`) and making it multi is a separate change.
- Drag-and-drop reparenting, or any change to folder `path` semantics.
- Versioning / version history.
- Per-**user** ACLs. Permissions stay role-based; there is no grants table and this brief does not add one.
- Refactoring the existing routes off `canEditRole`/`isAdmin` onto `can()`.
- Anything to do with the desktop sync agent, MinIO topology, or Nextcloud.

---

## 10. Deliverable

One PR to `main` on branch `fix/documents-manage-recycle-bin`.

The PR description must call out, explicitly:
- **`0012_documents_soft_delete_and_acl.sql` is UNAPPLIED** — the orchestrator applies it before deploy.
- The two new settings rows and that **`documents_trash_purge_enabled` ships `'false'`**.
- That **both web and worker need redeploy** (worker owns the purge sweep). Worker redeploy is manual in Coolify — no git webhook.
- The `allowed_roles` behaviour change, and **proof the §4 backfill ran** — show the row count it updated. This is the one place existing access could silently widen, so the reviewer needs to see that every currently-restricted folder came out of the migration as `{admin}`.
