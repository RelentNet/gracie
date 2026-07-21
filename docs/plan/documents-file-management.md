> ⛔ **SUPERSEDED — DO NOT BUILD FROM THIS BRIEF.** (2026-07-16) This brief's plan was rejected mid-flight. Both halves have since **shipped from other briefs**: the meeting-folder collision fix via **PR #45** (`docs/plan/fix-meeting-folder-collision.md`, series/occurrence keys + migration 0011), and file/folder rename-permissions-delete + the 60-day recycle bin via **PR #47** (`docs/plan/documents-manage-and-recycle-bin.md`, migration 0012). Kept for historical context only.

# Delegation Brief — Documents: file/folder management + meeting-folder fix

> Self-contained brief for a fresh, low-context Claude Code session.
> **Platform:** macOS, Node 24, pnpm. Next.js app-router web `apps/web`, BullMQ worker `apps/worker`, shared `packages/shared`, DB `packages/db`.
> **This is an ADDITIVE enhancement to the EXISTING Documents area.** Branch + PR. **Do NOT push to `main`.** Confirm the plan before coding.

---

## 0. The model (read first — a prior attempt got this wrong)

There is **ONE file home: the Documents area.** Do **NOT** build a separate/parallel "staff drive," a new `staff/` storage root, a `folders.kind` discriminator, or a new nav item. Files that aren't client-specific (Grace & Associates' own working files) belong **under the internal "Grace & Associates" org inside Documents** — it already owns generated docs and appears in the global Documents tree.

> **"Gracie Files" is a *separate future phase*** — a desktop sync agent (Nextcloud external-storage over the same MinIO bucket + Logto SSO, giving Mac/Windows local access to the Documents files). It is **OUT of scope here. Do not build it.** The plain-MinIO-object storage model is what will later enable it; nothing in this phase should pre-empt it.

Two workstreams:
- **Part A** — add file/folder **management** (delete, folder rename/restrict, upload attribution) to the existing Documents drive UI.
- **Part B** — fix a real **meeting-folder collision bug** in the worker.

---

## 0.1 Reuse map (trust, then verify)

| Concern | Reuse | File(s) |
|---|---|---|
| Drive UI (tree + list + modals) | reuse; add actions | `apps/web/components/FileBrowser/` — `DriveBrowser.tsx` (`DriveScope` = `client\|global`), `FileList.tsx`, `FolderTree.tsx`, `UploadModal/NewFolderModal/MoveModal`, `tree.ts` |
| Documents pages | reuse | global: `apps/web/app/(app)/documents/page.tsx`; per-client tab: `apps/web/components/FileBrowser/FileBrowser.tsx` |
| Folder/document data | reuse; extend | `apps/web/lib/data/documents.ts` (`listFolders`/`listDocuments`/`filterVisibleFolders`/`filterVisibleDocuments`/`moveDocumentToFolder`), `folders.ts` (`getFolderById`/`createFolder`/`folderSegment`), `uploads.ts` (`insertUploadDocument`/`buildUploadKey`/`ensureUploadFolder`/`clientSlug`) |
| Storage | reuse verbatim | `packages/shared/src/storage/s3.ts` (`deleteObject`/`moveObject`/`getObjectBytes`/`presignGet`) |
| Auth + gates (SECURITY) | reuse; do NOT weaken | `apps/web/lib/api-auth.ts` (`getRequestUser`/`isAdmin`/`isEditor`), `apps/web/lib/data/files.ts` (`canEditRole`/`canAccessKey`), `getUserIdByLogtoId` in `apps/web/lib/data/users.ts` |
| Existing routes | mirror their style | `POST /api/upload`, `GET+POST /api/folders`, `GET /api/documents`, `POST /api/documents/move`, `GET /api/files/url` (presign). **No DELETE/PATCH exist — add them.** |
| Embeddings | reuse | worker `ingest.processor.ts` writes `source_type='upload'`, `source_id=documentId`. Deleting a doc ⇒ delete `embeddings where source_id = documentId`. Generated docs are NOT embedded; transcripts are `source_id=meetingId` (separate). |
| Permissions | already defined | `packages/shared/src/constants/permissions.ts` has `file.deleteOwn`/`file.deleteAny`/`folder.delete`/`folder.manage`. Routes gate via the `canEditRole`/`isAdmin` tiers (not the `can()` matrix), like the existing handlers. |

---

## 1. Part A — Documents file/folder management (web)

1. **Delete a file** — new `DELETE /api/documents/[id]`: remove the MinIO object + the `documents` row + its `embeddings` (delete `where source_id = documentId`). Gate: **editor** tier; a non-admin may delete only their **own** upload (`documents.uploaded_by_user_id` === caller via `getUserIdByLogtoId`); **admin** deletes any; `canAccessKey(r2Key, isAdmin)` blocks deleting inside a restricted folder the caller can't see.
2. **Delete a folder** — new `DELETE /api/folders/[id]`: **admin-only**, recursive — collect the folder + descendants (by `path` prefix, the tree's nesting model), delete each contained doc's object + row + embeddings, then delete the folder rows (documents **before** folders so no `documents.folder_id` FK dangles).
3. **Edit a folder** — new `PATCH /api/folders/[id]`: rename `display_name` (**editor**) — **do NOT change `path`/object keys** (no object moves); toggle Admin-only visibility via `visibility` + `allowed_roles` (**admin-only**). A non-admin can't edit a restricted folder it can't see.
4. **Attribution** — populate `documents.uploaded_by_user_id` in `POST /api/upload` (resolve via `getUserIdByLogtoId`). Enables (1)'s delete-own. (Existing uploads have `null` → only admins can delete those; acceptable.)
5. **UI** — add a file **Delete** action to `FileList` (behind a small `ConfirmDialog`), and admin **Delete Folder** + **Edit Folder** actions to `DriveBrowser` (an `EditFolderModal`), wired for **both** the `client` and `global` scopes.
6. **GA-org uploads** — verify you can file GA's own files under the "Grace & Associates" org in the global Documents view (select its node → Upload). `getClient(id)` already returns internal orgs; if the upload picker can't *target* the internal org (the roster `/api/clients` excludes internal), make it selectable there. Small change — **not a new drive.**

**SECURITY:** reuse `filterVisibleFolders`/`filterVisibleDocuments`/`canAccessKey` verbatim; do not weaken the restricted-folder omission. When deleting, always remove the embeddings too (closes the orphaned-embedding gap).

---

## 2. Part B — Meeting-folder naming fix (worker; kill-switch-sensitive pipeline)

**Bug:** `apps/worker/src/processors/generate.processor.ts` → `persistDocuments` files generated docs into `clients/<slug>/generated/<YYYY-MM-DD>` named just the date, with fixed object keys `.../generated/<date>/<type>.md`. **Two meetings on the same day for one client collide** — same folder AND same object keys → the 2nd meeting's bytes **overwrite** the 1st (silent data loss). The **transcript** key `clients/<slug>/transcripts/<date>.txt` (~line 400) has the same bug.

**Fix:**
- Folder **display name** = `<Meeting Title> YYYYMMDD-HHMM` in **America/New_York** (the worker has no ET helper — add one via `Intl.DateTimeFormat({ timeZone: 'America/New_York' })`; the web mirror is `apps/web/lib/format.ts`).
- Make the folder **path unique per meeting**: `clients/<slug>/generated/<stamp>-<title-slug>-<meetingId first 8>` (invisible to users; guarantees no two meetings share a folder). Object keys land under it.
- Make the **transcript key unique per meeting** the same way.
- Only affects NEW meetings.

**Backfill (requested):** a **flagged, unapplied** SQL migration that renames existing generated **single-meeting** date folders to the new `display_name` (join `folders`→`documents`→`meetings`; ET via `to_char(m.date_time AT TIME ZONE 'America/New_York', 'YYYYMMDD-HH24MI')`). **Skip** folders mapping to **multiple** meetings (already-merged collisions can't be split). **display_name only — do NOT move objects.**

---

## 3. Gate + safety (before PR)

- **Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`.
- Any migration is **additive + idempotent**, hand-regen `packages/db/src/database.types.ts`, and **flag it for the orchestrator — do NOT apply it.**
- No secrets staged; worker **kill-switches untouched**; reuse the one storage module.
- Preview-verify delete / folder-edit at desktop + mobile. Note: the dev Supabase is on a private IP (may be unreachable from a sandbox); embeddings are produced by the worker ingest job (runs separately).
- **Confirm the plan before coding.**

## 4. Housekeeping note for the orchestrator
A prior (reverted) attempt left a stray row on the shared dev DB. Before/independently of this work, clean it:
```sql
delete from folders where path = 'staff' and display_name = 'Gracie Files';
alter table folders drop column if exists kind;  -- optional; unused
```
