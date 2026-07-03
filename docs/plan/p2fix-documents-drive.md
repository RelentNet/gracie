# Delegation Brief — P2-fix: Documents area = a real "drive" (upload, folders, filing)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. This is a **fix + completion** of the existing
> Documents area (Phase 2). The two-panel browser exists but its edit surface is **stubbed**
> and documents are never **filed into folders**, so it doesn't behave like a drive. Make it real.

## 0. The problem (diagnosed by the orchestrator)
The Documents UI (folder tree + file list + breadcrumb + role-gated restricted folders) is built and
Download works, BUT:
1. **Upload / New Folder / Move are non-functional stubs** — `apps/web/components/FileBrowser/FileBrowser.tsx`
   renders "Upload Here" + "New Folder" (editor-only) with **no onClick**; `FileList.tsx` Move/More are
   visual-only. There is no working way to add a file — the operator's #1 complaint.
2. **Documents are never filed into folders.** `apps/web/lib/data/uploads.ts insertUploadDocument` and the
   P5b generation processor (`apps/worker/src/processors/generate.processor.ts persistDocuments`) insert
   `documents` rows with **`folder_id = null`**. The browser lists a folder via `.eq('folder_id', folderId)`
   (`apps/web/lib/data/documents.ts getDocumentsByFolder`), so uploaded/generated docs never appear inside
   *Uploads* / *Generated Docs*.
3. **No firm-wide browser.** `FileBrowser` requires a `clientId`; the global Documents page lacks the
   *All Clients / Recent Documents / Knowledge Base* structure.

## Intended behavior (operator's design spec — the authority)
**Drive feel: navigable folders + subfolders, per client, with a working upload.**

**Global Documents page** — two-panel browser scoped to the whole firm:
- **Left tree, three roots:** (a) **All Clients** → one subfolder per client → that client's folder tree;
  (b) **Recent Documents** — a *virtual* folder (last ~20–30 docs touched across all clients, by modified
  date; no subfolders); (c) **Knowledge Base** — a *nav link* (routes to the KB page, not a real folder).
- **Right list adds a `Client` column**; Type badges Meeting(blue)/Upload(purple)/Auto-generated(emerald);
  Status badges Ready/Requires Review/Delivered; Download (all roles), Move/More (editors); **Upload button**
  in the header (editors), scoped to the selected client folder.

**Client Documents tab (Tab 6)** — same browser, client-scoped (no Client column). Folder tree:
- **Generated Docs** → a **date subfolder auto-created per pipeline run** containing that run's generated docs.
- **Uploads** → subtypes (Proposals, Capability Decks, Email Threads).
- **Transcripts** — **Admin-only** (restricted; already omitted server-side for non-admins — keep this).
- ("Pre-Meeting Briefs" is a **future** folder — P7 — do NOT build it now.)
- **"Upload Here"** scopes the upload to this client without asking for a client. **"New Folder"** lets
  editors create custom subfolders (Admins can mark them Restricted).

**Upload modal** (opened by "Upload Here"): file picker; client assignment (required only in the global view
when no client folder is selected); document type (Proposal, Capability Deck, Email Thread, Transcript, Other);
title override (defaults to filename); status (Ready / Requires Review). The upload API (`POST /api/upload`)
already exists — wire the modal to it; on success, refresh the browser and the new doc shows in its folder.

**Roles:** Admin — all folders incl. Transcripts, upload/move/new-folder/mark-restricted. Standard(editor) —
all except Transcripts, upload/move/new-folder. Viewer — read-only (no upload/move/new-folder), Transcripts
never rendered. (Server-side omission of restricted folders already exists — preserve it.)

## Existing code to BUILD ON / reuse (do NOT rebuild)
- `apps/web/components/FileBrowser/*` (FileBrowser, FolderTree, FileList, Breadcrumb) — the browser to finish.
- `POST /api/upload` (works), `POST/GET /api/folders`, `GET /api/documents`, `/api/files/url` (presign),
  `/api/files/move` (copy+delete + update r2_key) — wire the UI to these; add a folder-**create** handler +
  a document **move/refile** (set `folder_id`) if missing.
- `apps/web/lib/data/{documents,uploads,folders}.ts` — server data layer. `filterVisibleFolders` /
  `filterVisibleDocuments` (restricted-folder omission — the SECURITY gate; keep intact).
- `apps/web/lib/mock/documents.ts` — the intended folder shape (Generated Docs / Uploads / Transcripts).

## Scope — build this
1. **Wire "Upload Here"** → an upload modal (fields above) → `POST /api/upload` → refresh; scope to the
   selected client/folder. Editors only.
2. **File documents into folders (the drive-feel fix):** on upload (`insertUploadDocument`) AND P5b generation
   (`persistDocuments`), **find-or-create the target folder** and set `documents.folder_id`:
   - uploads → the client's `Uploads` folder (or a chosen subtype);
   - generated meeting docs → `Generated Docs/[YYYY-MM-DD]` (auto-create the date subfolder per run);
   - transcripts → the Admin-only `Transcripts` folder.
   Add a small `findOrCreateFolder(clientId, path, displayName, visibility)` helper in the data layer (folders
   are keyed by unique `path`). Backfill is optional; new writes must be filed.
3. **Wire "New Folder"** → create a subfolder under the selected folder (editors; Admin may mark restricted).
4. **Wire Move/More** → move a doc to another folder (update `folder_id`; use `/api/files/move` when the
   MinIO object should move too) — editors only.
5. **Global Documents view:** an All-Clients tree (per-client subfolders → that client's folders), a virtual
   **Recent Documents** node, and a **Knowledge Base** nav link; add the **Client** column to the list.
6. Keep every restricted-folder omission and role rule intact; loading/error/empty states throughout.

## Out of scope (do NOT build — later phases)
- **Pre-Meeting Briefs** folder/screen (P7); **Calendar** document pills (P4); dashboard Recent-Docs widget;
  the Intelligence-tab / KB AI-context wiring (already built in P6). No new document *generation*.

## Acceptance (all must pass before opening the PR)
- `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build` pass.
- As an editor, **upload a file from the Documents tab** → it lands in the correct folder and **appears in the
  browser under that folder** (verify `documents.folder_id` is set + the object in MinIO).
- **New Folder** creates a navigable subfolder; **Move** relocates a doc between folders.
- A **pipeline/generation run files its docs** under `Generated Docs/[date]` (verify via a `transcriptOverride`
  generate job for a seeded meeting, or by inserting a generated doc through the updated path).
- **Roles verified** (switch mock identity): a viewer sees no Upload/New Folder/Move and no Transcripts folder;
  an editor can upload but not see Transcripts; an admin sees Transcripts.
- Branch + **PR for review** (do NOT push to `main`); `git status` shows no secrets staged.

## Escalate (stop + ask the orchestrator) if
- Filing docs into folders needs a `folders`/`documents` **schema change** (a migration is fine — note it; but
  confirm before altering existing columns).
- The global **All Clients** tree can't be expressed with the current client-scoped `FileBrowser` without a
  larger refactor — propose the smallest change and ask.
- Anything would weaken the **restricted-folder (Transcripts) omission** — that's the security gate; don't loosen it.
