> ⛔ **ABANDONED / SUPERSEDED — DO NOT BUILD FROM THIS BRIEF.** (2026-07-16) The separate parallel "staff drive" framing below was **not** the operator's intent and was rejected. Corrected model: **all file management lives in Documents** (GA's own files under the internal Grace & Associates org) — that shipped as PR #47. **"Gracie Files" = the DESKTOP SYNC AGENT** (Nextcloud external-storage over the same MinIO + Logto SSO), an infra phase **deferred to v2.0** pending a new spec. Kept for historical context only.

# Delegation Brief — GF: Gracie Files (staff/team working drive on MinIO)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 + §1 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. Next.js app-router web `apps/web`, BullMQ worker `apps/worker`, shared `packages/shared`, DB `packages/db`.
> **This is an ADDITIVE feature that reuses the existing document/storage/ingest stack almost entirely.** Build on MinIO — NOT Seafile (see §0.2). **Branch + PR for review. Do NOT push to `main`.**

---

## 0. What this is
**Gracie Files (GF)** = a **staff/team working drive**: a place for GA staff to upload/organize/browse arbitrary files & folders that are **NOT tied to a client** (templates, internal resources, working docs), and — critically — that are **AI-readable** (ingested + embedded so the company-aware Assistant can use them), exactly like the existing client Documents.

### 0.2 Storage decision (settled — do not revisit)
Files MUST stay as **plain, individually-fetchable MinIO/S3 objects** so the AI ingest reads bytes directly. This is why we are **NOT using Seafile** (it stores opaque deduplicated blocks — verified). GF is a custom drive on the **existing MinIO** via `@gracie/shared/storage`. (Full rationale: the orchestrator's `gracie-files-storage-decision` memory + a deep-research pass.)

### 0.1 REUSE MAP — what already exists (trust, then verify)
| Concern | Reuse | File(s) |
|---|---|---|
| **S3/MinIO storage** (presign/put/get/delete/move) | **verbatim** | `packages/shared/src/storage/s3.ts` (`presignGet/presignPut/putObject/getObjectBytes/deleteObject/moveObject`), barrel `storage/index.ts`. One bucket, `S3_*` env. |
| Object-key builder | reuse; new root prefix | `apps/web/lib/data/uploads.ts:36` `buildUploadKey(folderPath, name, now)` — derives the whole key from `folderPath`. |
| **documents / folders tables** | reuse as-is | `packages/db/src/database.types.ts` (`documents` `:776`, `folders` `:892`). `client_id`, `folder_id` **nullable**; folders nest by **`path` string prefix** (no `parent_folder_id`); `visibility`(`all|restricted`)+`allowed_roles`. Types: `packages/shared/src/types/document.ts`. |
| **Ingest → embed pipeline** | reuse | upload `apps/web/app/api/upload/route.ts` → `enqueueIngest` (`lib/queue.ts:65`) → worker `apps/worker/src/processors/ingest.processor.ts` (`getObjectBytes → extractText → chunkText → embed → embeddings`). KB variant `kb-ingest.processor.ts` proves a non-client lane is possible. |
| **DriveBrowser UI** (tree + list + modals) | reuse; add a scope | `apps/web/components/FileBrowser/` — `DriveBrowser.tsx` (`DriveScope` union `:47`), `FolderTree/FileList/UploadModal/NewFolderModal/MoveModal/tree.ts`. |
| Folder visibility + key auth (SECURITY) | reuse | `apps/web/lib/data/documents.ts:133` (`filterVisibleFolders/Documents`), `files.ts:21` (`canAccessKey`), chat `chat-retrieval.ts:65` (`filterChunksByFolderVisibility`), assistant `company/access.ts`. |
| Permissions | reuse role-tier gating | `packages/shared/src/constants/permissions.ts`; routes gate via `canEditRole`/`isAdmin` (`lib/data/files.ts:11`), not the `can()` matrix. |
| The `internal` sentinel org ("Grace & Associates") | **the drive's owner — see §1** | already owns generated docs + surfaces in the global tree via `listDocumentOwnerOrgs` (`documents.ts:70`). |

## 1. The key architectural decision (orchestrator recommendation — build this unless the operator vetoes)
**Own the staff drive with the existing `internal` GA org's `client_id`, rooted at a `staff/` key prefix, and distinguish it from client docs with a new `folders.kind` discriminator.**

Why this is the 80/20 win: the ingest job payload + processor + `match_embeddings` retrieval are all **client-scoped** (`IngestJobPayload.clientId` is non-null; `embeddings.client_id` is written; `match_embeddings` is never called with null — `chat-retrieval.ts:24`). By giving staff-drive files the **internal org's real `client_id`**, they flow through the **existing ingest AND the existing company-aware Assistant retrieval with ZERO new ingest lane, no new RPC, no new `embedding_source`.** The `folders.kind` flag ('client'|'staff', default 'client') is what keeps the staff tree OUT of the client-Documents views and vice-versa.

**Locked v1 decisions/defaults (operator can adjust in review):**
- **Shared team drive:** all authenticated staff see the drive; editors upload/create/move; admins manage restricted folders + delete-any. (Per-user-private spaces = future.)
- **AI-indexed:** staff-drive files are ingested/embedded and visible to the Assistant (this is the whole point of the MinIO constraint). Sensitive files go in a **restricted** folder (admin-only + excluded from non-admin retrieval — the existing mechanism).
- **Sharing links + object versioning = fast-follows, NOT v1.**
- Start populating `documents.uploaded_by_user_id` on staff uploads (attribution + future `deleteOwn`).

### 1.1 IN (v1) vs OUT
**IN:** a `staff/`-rooted, internal-org-owned drive — browse (tree+list), create folders, upload (→ ingest/embed), move, download, **delete** (files + folders), restricted (admin) folders, a nav entry, and AI-readability via the existing Assistant. Small migration (`folders.kind`).
**OUT (defer):** sharing links, versioning, per-user-private spaces, native OS sync clients (that's the documented Nextcloud-external upgrade path — not built), any Seafile.

### 1.2 Build order (each step green-gates)
1. **Migration `0011`** — additive `folders.kind text not null default 'client'` (+ hand-regen `database.types.ts`; orchestrator applies). Optionally a partial index for staff-tree listing.
2. **Storage/data layer** — a `staff/` root + `kind='staff'` folder ops; internal-org id resolution (reuse the `internalOrgId` lookup used by calendar-scan/generate).
3. **API** — list/create-folder/upload/move/download/**delete** for the staff scope (see §2).
4. **UI** — a `{kind:'staff'}` `DriveScope` + nav entry; reuse `FolderTree/FileList/modals`.
5. **Ingest** — confirm staff uploads flow through the existing `ingest` queue with the internal-org `client_id` and become Assistant-visible.

## 2. API (reuse, with client-less/staff variants)
The existing upload + `POST /api/folders` **hard-require `clientId`** and build `clients/<slug>/…` keys; `documents/move` enforces **same-client**. For GF, the cleanest path is to **pass the internal org's `client_id`** (so those client-scoped guards are satisfied) while writing folders with `kind='staff'` + a `staff/` `path` root. Where the `clients/<slug>` pathing is hardcoded (`ensureUploadFolder`/`clientSlug` in `uploads.ts`), generalize to accept an explicit staff target folder, OR add thin `staff` route variants that mirror the existing handlers. **New: DELETE routes** — none exist today for drive files/folders (only KB/contacts/etc. have DELETE); GF needs `DELETE` for a staff file (object + `documents` row + its `embeddings`) and a staff folder (recursive, restricted→admin), wiring `file.deleteOwn`/`file.deleteAny`/`folder.delete`. Reuse `moveObject`/`deleteObject`/`canAccessKey`.

## 3. Permissions + visibility (reuse)
Gate via the existing `canEditRole`/`isAdmin` role tiers (viewer = read-only; editor = upload/folder/move; admin = restricted + delete-any). Reuse the binary `visibility`(`all|restricted`)+`allowed_roles` model + `filterVisibleFolders/Documents` + `canAccessKey` verbatim — a staff drive is `all` by default with admin-only `restricted` subfolders. **Do NOT weaken** the `filterVisible*` / `canAccessKey` / chat-retrieval visibility gates. When deleting a doc, delete its `embeddings` too (also closes the pre-existing orphaned-embedding gap for staff files).

## 4. Gate + safety (before PR)
- **Green gate:** `pnpm -w typecheck` + `pnpm -w lint` + `pnpm --filter web build`.
- **Migration `0011`** additive + idempotent, hand-regen `database.types.ts`, and **DO NOT apply it** — flag for the orchestrator.
- **AI-readability proof (the whole point):** upload a staff-drive file → confirm it ingests (`embeddings` rows with the internal-org `client_id`, `source_type='upload'`) → confirm the company-aware Assistant can retrieve it, and a **viewer cannot** retrieve a file in a **restricted** staff folder (role-gate test).
- No secrets staged; kill-switches untouched; reuse the storage module (don't add a second S3 client).
- Use the preview tools to verify the drive UI (tree/upload/move/delete/download) at desktop + mobile (RL primitives already make it responsive).

## 5. PR notes
Confirm: the `folders.kind` migration (unapplied); the internal-org-owner + `staff/` root approach (or a flagged alternative if you diverged); every new/changed route; that ingest + Assistant retrieval work for staff files; the restricted-folder viewer-gate test result; delete removes object+row+embeddings. List OUT items you intentionally skipped.

## 6. Note on the alternative (if the operator rejects internal-org-owner)
The clean-but-heavier alternative is a **first-class scope**: `client_id = null` staff docs + a dedicated `embedding_source='staff_drive'` + a `kb-ingest`-style queue/payload + a `match_staff_embeddings` RPC + Assistant retrieval wiring. More code, cleaner separation, and it decouples the drive from the GA org. Only take this if the internal-org coupling is unacceptable — otherwise §1 is materially less work for the same v1 behavior.
