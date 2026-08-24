# Assistant `create_document` tool — save chat content into Documents

## What & why
Users want to tell the Assistant "save this as a document in DSS's folder" and have
the assistant-authored write-up land in the **Documents** area. Until now the
Assistant's company tools were strictly **read-only**, and its only write tools were
automations (propose → confirm). This adds one write tool, `create_document`, that
files a `.md` document into a client's Documents — reusing the exact upload
write-path so it's extracted, embedded, and searchable like any manual upload.

## Files
- `apps/web/lib/assistant/documents/create-document.ts` — **pure core** (no
  `server-only`; server types imported type-only). Holds `matchClient`,
  `runCreateDocument(args, ctx, deps)`, the tool spec, and `DOCUMENT_TOOLS` /
  `DOCUMENT_TOOL_NAMES`. Deps are **injected** so the units run with the DB/storage
  stubbed — mirrors the pure/server split in
  `lib/assistant/company/access-policy.ts` vs `access.ts`.
- `apps/web/lib/assistant/documents/tools.ts` — **server wrapper**: builds the real
  deps (`listClients`, `listFolders`, `ensureUploadFolder`, `clientSlug`,
  `buildUploadKey`, `putObject`, `insertUploadDocument`, `enqueueIngest`) and exposes
  `executeDocumentTool(name, rawArgs, ctx)` (never throws → JSON `{ok:false,reason}`).
- `apps/web/lib/assistant/documents/tools.test.ts` — node:test units (13).
- `apps/web/app/api/assistant/chat/route.ts` — advertises `DOCUMENT_TOOLS` and
  dispatches `DOCUMENT_TOOL_NAMES` to `executeDocumentTool`, passing the **fixed turn
  identity** `{ userId: ownerId, role: caller.role }` (same pattern as the action
  tools' `ownerUserId` — never from tool args).
- `apps/web/lib/assistant/prompt.ts` — new "Saving documents" block telling the
  model it can save write-ups into a client's folder, that it's reversible (recycle
  bin), that there's no confirm card, and that only editors can save.

## The tool
`create_document(client, title, content, folder?)`:
1. **Role gate on the fixed turn identity.** Editors only (admin/standard), mirroring
   `/api/upload`'s `canEditRole`. A viewer gets a plain
   `{ok:false, reason:"You don't have permission…"}` result — not a throw.
2. **Resolve the client** strictly (`matchClient`): uuid → exact name → exact
   initials → unique substring. Unknown or **ambiguous** (>1 candidate at a tier)
   returns a clear error listing the candidates — stricter than the read tools'
   silent first-match, because this is a write.
3. **Resolve the folder.** `folder` name matched within the client (exact →
   substring); otherwise the client's **Uploads** folder via `ensureUploadFolder`.
   A restricted (Admin-only) named folder needs admin, mirroring `/api/upload` §D14.
4. **Store + insert + enqueue**, reusing the canonical helpers: `buildUploadKey` →
   `putObject` (`text/markdown`) → `insertUploadDocument` → `enqueueIngest`. Content
   is stored as `<title>.md`; the uploader is stamped from `ctx.userId`.
5. Returns `{ ok:true, documentId, client, folder, title }` for the model to relay,
   or `{ ok:false, reason }` on any failure (no stack leaked).

## Decisions (flagged)
- **`source_badge` reused: `upload`.** `insertUploadDocument` already stamps
  `source_badge='upload'` (and `document_type='upload'`). Reusing it means **NO
  migration** — no new enum value. A dedicated "assistant" badge would be nicer for
  provenance but isn't worth a migration; a fast-follow could add one if wanted.
- **Default folder: the client's `Uploads` folder** (`ensureUploadFolder(..,'other')`),
  the same default a manual upload with no chosen folder lands in.
- **Client disambiguation:** exact-before-substring, and >1 match at any tier →
  ambiguous error naming the candidates (write safety), instead of the read tools'
  first-wins behavior.
- **No propose→confirm.** This is a reversible internal write (Documents recycle bin),
  so the model confirms conversationally — matching the brief. No confirm route added.
- **Partial-write ceiling (same as `/api/upload`):** if `enqueueIngest` throws after
  the object + row are written, the doc exists but isn't embedded yet; the executor
  reports failure. Not compensated — identical to the existing upload route's behavior.

## Tests / gate
- 13 node:test units: `matchClient` (exact / initials / unique substring / uuid /
  unknown / unknown-uuid / ambiguous / empty) and `runCreateDocument` (viewer denied
  + never touches storage, editor happy path with uploader-id from ctx, unknown +
  ambiguous client, empty content). All pass.
- Full gate green: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm --filter web test`
  (104/104).
- **Not preview-verified**: the tool only executes inside a full chat turn (LLM
  provider + Redis + MinIO + DB on the LAN backend), not reachable from the build
  sandbox. Relied on the green gate + units.

## Natural next step (out of scope here)
"Promote a chat **attachment** file into Documents" — take an existing
`apps/web/app/api/assistant/attachments/route.ts` upload and file it into a client's
folder (copy the object + `insertUploadDocument`, skip re-authoring content). A
separate small tool that reuses the same write-path; deliberately not built here to
keep this change to the create-from-chat path only.
