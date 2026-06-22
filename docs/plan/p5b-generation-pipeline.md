# Delegation Brief — P5b: Generation Pipeline (Recall webhook → 6 docs → tasks → master record → notify)

> Self-contained brief for a fresh, low-context Claude Code session. Read §0 first.
> **Platform:** macOS, Node 24, pnpm 10.33.0. This is the SECOND half of P5 — the
> **generation** path. P5a (ingest: upload → extract → chunk → embed → pgvector) is
> DONE and committed (`dd4cf08`). Build ON it; do not rebuild ingest.

## 0. Read first (cold-start context)
- `docs/HANDOFF.md` — current state (Logto active; infra up; worker is a real BullMQ service; P5a done).
- `docs/06-ai-pipeline.md` — **§2 (5-layer prompt), §3 (the 6 docs), §4 (meeting pipeline — THE spec),
  §6 (task-extraction JSON), §8 (failure handling), §9 (sequential+queued)**. This is the authority.
- `docs/04-database-schema.sql` — tables `meetings`, `documents`, `tasks`, `master_record_entries`,
  `pipeline_runs`, `notifications`, `embeddings`; enums `document_type`, `pipeline_status`,
  `pipeline_run_source/status`, `embedding_source`, `notification_type`.
- `docs/05-api-route-map.md` — `POST /api/webhooks/recall` contract.
- `docs/02-tech-decisions.md` — **D7** (sequential generation), **D9** (pinned embedder), **D11** (provider interface).
- `docs/07-integrations.md` — §2 OpenAI, §3 Recall (webhook + transcript fetch), §4 MinIO.

### Existing code to BUILD ON / reuse (do NOT duplicate)
- `apps/worker/` — BullMQ foundation: `createQueue`/`createWorker` factories, shared ioredis
  connection, `apps/worker/src/processors/ingest.processor.ts` (mirror its structure + failure handling),
  `apps/worker/src/lib/{extract,chunk}.ts`, `apps/worker/src/queues/ingest.queue.ts` (mirror for the new queue).
- `@gracie/db` — `getActiveProvider()` (generation provider+model, key via `getCredential`),
  `getEmbedder()` (pinned), `getServerClient()`, `getCredential('recall')`.
- `@gracie/shared/ai` — **already written, currently dormant — WIRE THESE IN:**
  - `GENERATED_DOC_SPECS` / `GENERATED_DOC_ORDER` / `getDocSpec` (`generated-docs.ts`) — the 6 types, order, `requiresReview`, `responseFormat`.
  - `assemblePrompt(context, { responseFormat })` (`prompts/assembly.ts`) — builds the 5-layer system + user message + the `[VERIFY]`/tone/JSON rules. You supply layer 3 (the per-doc instruction).
  - `parseTaskExtraction(content)` (`tasks-extract.ts`) — validates the task-checklist JSON → `ExtractedTask[]`.
  - The provider interface (`provider.ts`): `provider.generate({ model, system, messages, responseFormat })`.
- `@gracie/shared/storage` — `putObject`, `getObjectBytes` (S3/MinIO; never expose creds to the frontend).
- `match_embeddings` RPC (Supabase) for historical retrieval; the embeddings table is already populated by P5a.

## Global rules (non-negotiable)
- **AI calls ONLY through the provider interface** — generation via `getActiveProvider()`, embeddings via
  `getEmbedder()` (both from `@gracie/db`). NEVER import the OpenAI SDK. Embeddings stay pinned to
  `text-embedding-3-small` / 1536-dim (D9).
- **Generation is SEQUENTIAL** in the fixed order (D7, `GENERATED_DOC_ORDER`): analysis → memo →
  client_summary → task_checklist → internal_email → client_email. No concurrent provider calls.
- **No-auto-send (absolute):** `client_summary` (doc 3) and `client_email` (doc 6) are `requires_review = true`
  and are never sent. Just stored + flagged.
- **Frontend never touches MinIO**; backend never blocks on the long job (webhook enqueues, returns fast).
- Keep `@gracie/shared` **client-safe** — queue names + payload TYPES only; no `bullmq`/Node there.
- Never reintroduce removed services (Make/Drive/Otter/tldv/Gmail-send).
- **Never commit secrets** (`git check-ignore` before `git add`; `*.env.local` + `docs/SECRETS.md` ignored).
- Verify before claiming done; match codebase style (strict TS, `.js` import specifiers, JSDoc).

## Worker env (ALREADY RECONSTRUCTED — do not regenerate)
`apps/worker/.env.local` is in place and verified against live infra (Supabase, MinIO bucket `ga-app-dev`,
Redis with auth, OpenAI). It has `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`APP_ENCRYPTION_KEY`, `S3_*`, `REDIS_URL`, `OPENAI_API_KEY`, `RECALL_API_KEY`. **The OpenAI + Recall keys
are also stored encrypted in `integration_credentials` and resolve via `getCredential()`** — prefer that
path. If you spawn a fresh git worktree, copy the git-ignored env in first:
`cp /Users/phoenix/code/gracie/apps/worker/.env.local apps/worker/.env.local` (same for `apps/web` once built).

## Scope — build this
1. **Queue contract** — add a `generate` (meeting-pipeline) entry to `QUEUE_NAMES` + a `GenerationJobPayload`
   type in `@gracie/shared` (`meetingId`, `botJobId`, optionally a direct `transcriptOverride` for testing).
   Add an enqueue helper (mirror P5a's ingest queue).
2. **Webhook route (web)** — `POST /api/webhooks/recall` (`runtime = 'nodejs'`): verify the Recall/Svix
   signature (secret via `getCredential` / env `RECALL_WEBHOOK_SECRET` — **NOT available yet; see §Escalate**),
   confirm a `meetings` row exists AND `bot_job_id` matches the payload (else 4xx reject), enqueue a `generate`
   job, return **202** immediately. Set `meetings.pipeline_status = 'processing'`.
3. **Generation core** (`apps/worker`, reusable module, e.g. `lib/generate.ts`) — given a transcript + client +
   meeting context, run the 6-doc sequence per `docs/06` §4. For each doc: build layer-3 instruction (author the
   6 per-doc instruction strings — wording lives here, not in `@gracie/shared`), `assemblePrompt(...)`,
   `provider.generate(...)`, collect result. Return the 6 outputs + the parsed task list. Make it callable from
   both the meeting processor and (later) the upload path — keep it pipeline-agnostic.
4. **Meeting generation processor** (`apps/worker/src/processors/generate.processor.ts`), per `docs/06` §4:
   - **Transcript:** use `transcriptOverride` if present (test path); else fetch from Recall's API using
     `getCredential('recall')` + `bot_job_id`. Store raw transcript in MinIO at
     `clients/[slug]/transcripts/[YYYY-MM-DD].txt`. Set `meetings.transcript_received = true`.
   - **Embed transcript:** chunk (reuse `chunk.ts`) → `getEmbedder()` → insert `embeddings`
     (`source_type = 'transcript'`, `source_id = meetingId`, `client_id`).
   - **Historical context (layer 5):** `match_embeddings` top-5 client-scoped + open tasks
     (`status != 'complete'`) for the client → a context string.
   - **Generate** the 6 docs via the core (sequential). Store each in MinIO at
     `clients/[slug]/generated/[YYYY-MM-DD]/<type>.md` and insert a `documents` row
     (`source_badge = 'meeting'`, `meeting_id`, `client_id`, correct `document_type` — **see mapping below**,
     `requires_review` from the spec, `status='ready'`, except docs 3 & 6 → `status='needs_review'` if you
     prefer to surface them; follow `requires_review`).
   - **Tasks:** `parseTaskExtraction(taskChecklistContent)` → insert `tasks` (`client_id`, `description`,
     `source_meeting_id`, `source_document_id` = the checklist doc, `priority_flag` from `priority`; resolve
     `owner_hint` → `owner_user_id` by matching `users` name/email, else null; parse `due_hint` → `due_date`
     when unambiguous, else null). If tasks found → `meetings.has_open_items = true`. On invalid JSON: one
     stricter re-ask, then store the checklist doc + skip task insert (docs/06 §8).
   - **Master record:** append one `master_record_entries` row (`client_id`, `meeting_id`, `summary` = a short
     digest, e.g. from the analysis/memo).
   - **pipeline_runs:** insert a row (`source = 'recall'`, `started_at`, `completed_at`, `duration_seconds`,
     `documents_generated`, `status` = 'success' | 'partial' | 'failed', `error_message` on failure).
   - **Status + notify:** `meetings.pipeline_status = 'complete'` (`pipeline_completed_at`); insert a
     `notifications` row per attendee (`meetings.attendee_user_ids`) — `type = 'documents_ready'`,
     title `"Documents ready for <Client> — <Date>"`, `link` to the client.
   - **Failure handling (docs/06 §8):** transient AI/storage errors throw → BullMQ retries w/ backoff; after the
     budget → `meetings.pipeline_status = 'needs_attention'` + `pipeline_runs.status='failed'` + error message.
     Use `createWorker`/`createQueue` factories.
5. **`document_type` enum mapping** (IMPORTANT — `GeneratedDocType` ≠ enum for emails):
   `post_meeting_analysis→post_meeting_analysis`, `internal_memo→internal_memo`, `client_summary→client_summary`,
   `task_checklist→task_checklist`, `internal_email→internal_email_draft`, `client_email→client_email_draft`.
6. **Transcript watchdog** (`docs/06` §8) — a BullMQ delayed/repeatable check: meetings with
   `pipeline_status='awaiting_transcript'` (or dispatched bot, no transcript) for **>90 min** →
   `pipeline_status='needs_attention'` + in-app `notifications` (`type='needs_attention'`) to the meeting lead.
   **Resend email is deferred to P7** (not configured) — do in-app/log only; leave a clear TODO.

## Out of scope (DO NOT build — later phases)
- **Manual-upload generation** (docs/06 §5 output-set selection) — keep the generation core reusable, but do
  NOT wire the upload path's doc-set selection now (follow-on).
- **`.docx` rendering** — store generated docs as `.md`; `.docx` export is a later polish (note it).
- Intelligence **chat** retrieval/streaming UI (P6); Knowledge Base (P6); calendar scan / bot dispatch (P4);
  Resend email delivery (P7); a polished generated-docs UI (the data + `documents` rows are enough).

## Acceptance (all must pass before opening the PR)
- `pnpm -w typecheck` + `pnpm -w lint` pass; `pnpm --filter web build` passes.
- Start the worker (`pnpm --filter worker dev`). **Enqueue a `generate` job with a `transcriptOverride`
  (a realistic sample transcript) for a seeded client/meeting** (bypasses the webhook + Recall fetch). Verify in
  Supabase: **6 `documents` rows** (correct `document_type`s; docs 3 & 6 `requires_review=true`), **≥1 `tasks`
  row**, **1 `master_record_entries`**, **1 `pipeline_runs`** (`status='success'`, `documents_generated=6`),
  transcript `embeddings` rows (`source_type='transcript'`, 1536-dim), `meetings.pipeline_status='complete'`,
  and `notifications` for the attendees. Generated `.md` objects exist in MinIO.
- `[VERIFY: ...]` tags appear where the model is uncertain; the swappable model is read from settings.
- The webhook **rejects** a payload whose `bot_job_id` doesn't match a meeting (4xx) and returns 202 on a valid one.
- Branch + **PR for review** (do NOT push to `main`); `git status` shows no secrets staged.

## Escalate (stop + ask the orchestrator) if
- **`RECALL_WEBHOOK_SECRET` / the live Recall transcript-fetch endpoint** is needed to finish — the webhook
  secret does not exist yet (the endpoint isn't registered with Recall until deploy). Build + unit-test
  signature verification behind the secret, and prove the pipeline end-to-end via `transcriptOverride`. Flag
  the secret as a deploy-time follow-up rather than blocking.
- Storing generated docs as `.docx` vs `.md` is contested, or the `documents.folder_id` (which folder generated
  docs belong to) is ambiguous vs `docs/04`/seed.
- Anything would force a change to the shipped provider interface, the `@gracie/shared` AI groundwork, or the
  worker factories.
