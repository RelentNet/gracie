# Delegation Brief — Pipeline fleet-view + bounded meeting recovery ("PR 2")

> Self-contained brief for a fresh Claude Code session. Read §0–§1 first.
> **Platform:** macOS, Node 24, pnpm. Web `apps/web`, worker `apps/worker`, DB `packages/db`.
> **Branch + PR. Do NOT push to `main`.** Captured 2026-07-20 after a real production incident (below).

---

## 0. The gap (observed live, 2026-07-20)
When the Recall webhook was broken, several meetings recorded fine but never generated docs. Recovering them required **pasting `fetch()` calls into the browser console** because **there is no UI to find or recover a stuck meeting.** Two problems:

1. **Pipeline page is an error log, not an activity feed.** `apps/web/app/(app)/pipeline/PipelineErrorsPanel.tsx` → `/api/pipeline/runs` → `listPipelineRunErrors(['failed','partial'])` queries **only `pipeline_runs`** with those statuses. Successful runs are hidden, and — critically — **meetings flagged `needs_attention` by the transcript watchdog have NO `pipeline_runs` row at all** (generation never started), so they are **completely invisible** and have **no re-trigger button**. The page is even titled "Pipeline / Live status of meeting document generation", which over-promises.
2. **No pre-flight check.** Some stuck meetings have **no transcript on Recall** (silent/short bots) — re-triggering those just burns failed jobs + noise. Nothing tells you which are actually recoverable.

The re-trigger endpoint itself is fine: `POST /api/pipeline/[meetingId]/retrigger` (admin `pipeline.triggerManual`, idempotent, enqueues on the same generate queue). Only the *surfacing* and *bulk* story is missing.

## 1. Goal
- **Pipeline becomes a real fleet view:** every run (success / partial / failed) **plus** watchdog-flagged `needs_attention` meetings that have no run, in one list. Filterable by status; a **"needs attention"** section pinned on top. Show duration, docs generated, client, time. Each row **re-triggers** and **links to the meeting-occurrence page** (`docs/plan/meeting-occurrence-page.md`).
- **Recovery is safe and bounded:** a pre-flight Recall check marks which stuck meetings actually have a downloadable transcript; bulk re-sync is capped and queued, and does **not** spam attendees.

## 2. Why "sync all" must be bounded (cost reality)
One meeting's generation = **fetch transcript → embed the whole thing → 6 documents generated SEQUENTIALLY via the LLM → tasks/master-record/MinIO → notify every attendee.** That's ~6 sequential LLM completions + embeddings per meeting — minutes and real money. Precedent: the `gpt-4o` **30k-TPM 429** incident (fixed by reverting `ai_model` → `gpt-4o-mini`). At today's handful of meetings, bulk is harmless; once `calendar_bot_dispatch_enabled` is ON and meetings record continuously, an unbounded backfill over a 30-meeting backlog risks: rate-limit 429s → BullMQ retries → **more** load (retry amplification), unbounded spend with no preview, a **notification storm**, and starving the queue of just-ended meetings.

**Framing:** enqueueing is cheap; processing is expensive. So bulk is fine *if* filtered, capped, and queued — no new throttling machinery needed (BullMQ concurrency drains individual jobs serially).

## 3. Scope
### 3.1 Fleet view (web, read + existing re-trigger)
- New data fn (extend `apps/web/lib/data/pipeline.ts`): union of (a) recent `pipeline_runs` (all statuses) and (b) `meetings` where `pipeline_status='needs_attention'` (or `bot_dispatched AND NOT transcript_received`) that have **no** run row. Return a unified row: {meetingId, title, client, when, state, docsCount, durationS, botJobId, recoverable?}.
- `PipelineErrorsPanel` → a fuller table with a status filter and a pinned "needs attention" group; keep the existing re-trigger button; add a row-link to `/meetings/[id]`.
- Fix the page copy so "Pipeline" honestly reflects an activity feed.

### 3.2 Pre-flight recoverability check
- A server action / route that, for a set of stuck meetings, asks Recall (`GET /bot/{bot_job_id}/`) whether a recording exists with `media_shortcuts.transcript.data.download_url` present → `recoverable: true`. Only recoverable meetings get an enabled "re-sync" control. (This mirrors the throwaway diagnostic used during the incident: `scratchpad/check_stuck.py`.)
- **Log/annotate the non-recoverable ones** ("no transcript on Recall") so it's clear why they can't be re-run — do not silently hide them.

### 3.3 Bounded bulk re-sync
- A "re-sync selected / re-sync all recoverable" action that: caps at **N per invocation** (config, e.g. 10), **previews exactly what will run** first, then enqueues **individual** generate jobs (reusing `enqueueGenerate`). No custom throttling — BullMQ concurrency serializes.
- **Suppress attendee notifications on backfill.** Add a `source: 'backfill'` (or `notify: false`) flag to the generate job payload (`packages/shared` `GenerationJobPayload`); in `apps/worker/src/processors/generate.processor.ts` skip `notifyAttendees(...)` when set. This is the thing that actually bites at scale (re-syncing 30 meetings would fire 30× attendee notifications).
- `log()` any cap/truncation so a partial backfill never reads as "covered everything".

## 4. Relationship to the meeting page
Pipeline = **fleet view**; the meeting-occurrence page = **detail view**. Rows link into it. Don't duplicate per-meeting status UI in three places (Pipeline, client page, meeting page) — the meeting page owns per-occurrence detail; Pipeline owns the cross-meeting list + recovery actions.

## 5. Gate + safety
- Green gate: `pnpm -w typecheck` + `pnpm -w lint`; worker tests stay green; add a test for the notification-suppression flag (backfill → no attendee notifications).
- Admin-gated exactly like today (`pipeline.viewErrors` / `pipeline.triggerManual`).
- Idempotent generation is preserved (clears prior docs/tasks/embeddings by meeting).
- No secrets staged; worker + web deploy separately (a payload-flag change touches BOTH — ship the worker's tolerance for the flag before/with the web producer).
