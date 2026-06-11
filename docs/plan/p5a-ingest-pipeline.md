# Delegation Brief — P5a: Ingest Pipeline (manual upload → extract → chunk → embed → pgvector)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** Windows 11, Node 24, pnpm 10.33.0 (if `pnpm` isn't on PATH use
> `corepack pnpm@10.33.0`). Shell: PowerShell. This is the FIRST half of P5 — the
> **ingest** path only. The 6-document GENERATION is a separate later phase (P5b) — do NOT build it.

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` — current state (Logto active; infra up; worker is a real BullMQ service).
- `docs/06-ai-pipeline.md` — **§4 ingest flow, §5 manual-upload pipeline, §8 failure handling**.
- `docs/04-database-schema.sql` — `embeddings`, `documents` tables (+ `match_embeddings`).
- `docs/02-tech-decisions.md` — **D8** (text extraction scope), **D9** (embeddings pinned),
  **D11** (provider interface), **D14** (upload = editor-only).
- `docs/07-integrations.md` — §4 MinIO (S3, presigned URLs), §2 OpenAI.
- Existing code to build on / reuse (do NOT duplicate):
  - `apps/worker/` — the BullMQ foundation: `createQueue`/`createWorker` factories, shared
    ioredis connection, `QUEUE_NAMES`/`JOB_NAMES` in `@gracie/shared`.
  - `packages/db` — `getEmbedder()` (returns the OpenAI embedder, key resolved via
    `getCredential('openai')`), `getServerClient()`.
  - `packages/shared/src/ai` — provider interface + `getEmbedder` path; `packages/shared/src/storage`
    — S3/MinIO presign + object helpers.
  - `apps/web/lib/data/files.ts`, `app/api/files/*` — existing presign + path-authorization pattern.

## Global rules (non-negotiable)
- **AI calls ONLY through the provider interface** — use `getEmbedder()` from `@gracie/db`;
  NEVER import the OpenAI SDK directly. Embeddings are pinned to `text-embedding-3-small` (1536-dim, D9).
- **Frontend never touches MinIO directly** — presigned URLs only; S3 creds are backend-only.
- OpenAI key comes from `getCredential('openai')` (already stored in API Settings) — never hardcode.
- Keep `@gracie/shared` **client-safe** — queue names + job-payload TYPES only there; no `bullmq`/Node.
- Never reintroduce removed services (Make/Drive/Otter/tldv/Gmail-send).
- **Never commit secrets** (`git check-ignore` before `git add`; `*.env.local` + `docs/SECRETS.md` ignored).
- Verify before claiming done; match codebase style (strict TS, `.js` specifiers, JSDoc); commit + push to `main`.

## Worker env (IMPORTANT — add these)
The ingest processor runs in `apps/worker` and must reach Supabase + MinIO + decrypt the stored
OpenAI key. Add to `apps/worker/.env.local` (values from `docs/SECRETS.md` / `apps/web/.env.local`):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, **`APP_ENCRYPTION_KEY`** (required so `getCredential`
can decrypt the OpenAI key), and `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET`/
`S3_REGION`/`S3_FORCE_PATH_STYLE` (plus the existing `REDIS_URL`).

## Scope — build this
1. **Upload API (web)** — `POST /api/uploads` (or per `docs/05`): accept a file for a `clientId`,
   **editor-only** (admin/standard; viewer → 403, D14). Store the object in MinIO at
   `clients/[slug]/uploads/[YYYY-MM-DD]/<file>` (reuse the presign/storage helpers), insert a
   `documents` row (`source_badge='upload'`), then **enqueue an ingest job**. (Presigned-PUT-then-trigger
   or server-side receipt — your call; keep frontend off MinIO creds.)
2. **Queue contract** — add an `ingest` entry to `QUEUE_NAMES` + an `IngestJobPayload` type
   (documentId, clientId, r2Key/objectKey, fileName, mimeType) in `@gracie/shared`. Add a small
   enqueue helper the web route uses (BullMQ `Queue` from the shared name; web needs `REDIS_URL`).
3. **Ingest worker processor** (`apps/worker`), per `docs/06` §4/§5:
   - fetch the object bytes from MinIO (S3 get);
   - **extract text** by type (D8): `.docx`→mammoth, `.pdf`→pdf-parse, `.csv`→papaparse, `.txt`/`.md`→native;
     `.mp3/.mp4` → out of scope (skip + flag);
   - **chunk** the text (sensible size + small overlap);
   - **embed** chunks via `getEmbedder()` (batch);
   - insert into `embeddings` (`source_type='upload'`, `client_id`, source = the document id, chunk text +
     1536-dim vector + index);
   - update the document's status; on extraction/embedding failure, follow `docs/06` §8 (retry via BullMQ;
     mark `needs_review` if unrecoverable).
   - Use the existing `createWorker`/`createQueue` factories.

## Out of scope (DO NOT build — later phases)
- The 6-document **generation**, task extraction, master-record, notifications (that's **P5b**).
- The **Recall webhook / automatic meeting** pipeline (needs a meeting — P4-adjacent).
- Intelligence chat retrieval (P6). A polished upload UI (the API + a minimal trigger is enough; the
  existing `app/(app)/upload/page.tsx` placeholder can stay until a UI pass).

## Acceptance (all must pass before commit)
- `pnpm -w typecheck` + `pnpm -w lint` pass.
- Start the worker (`pnpm --filter worker dev`) and the web app; **upload a sample `.txt` and `.pdf`** for a
  seeded client via the new API → the ingest job runs → **`embeddings` rows are created** for that document
  (verify count > 0 and each vector is **1536** dims; you can query Supabase directly to confirm).
- A `match_embeddings` (or direct similarity) query, client-scoped, returns the relevant chunk.
- **Viewer is denied** upload (403); editor allowed.
- Commit + push to `main`; `git status` shows no secrets staged.

## Escalate (stop + ask) if
- Chunking strategy or embeddings table columns are ambiguous vs `docs/04` — confirm, don't guess.
- The worker can't reach Supabase/MinIO or `getCredential('openai')` fails to decrypt (check
  `APP_ENCRYPTION_KEY` is in `apps/worker/.env.local`).
- Anything would force a change to the already-shipped provider interface or worker factories.
