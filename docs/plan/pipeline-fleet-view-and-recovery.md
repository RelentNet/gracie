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

### 3.2 Pre-flight recoverability check — **THREE-WAY, not two-way** (revised 2026-07-21)
⚠️ **A second, more common failure mode was found live on 2026-07-21 that this section originally got wrong.** `GA/Leap Metrics` recorded perfectly (`recording.status=done`, `video_mixed` downloadable) but its **transcription failed** — `media_shortcuts.transcript.status = {code: "failed", sub_code: "provider_connection_failed"}`, so there is **no transcript `download_url`**. The original rule ("no download_url → not recoverable") would wrongly mark it dead and hide it. **It is fully recoverable — by re-transcribing the surviving recording.**

Classify each stuck meeting into one of three states, and drive a different action from each:
| State | Detected by | Action offered |
|---|---|---|
| **`regenerate`** | transcript exists (`transcript.status=done`, `download_url` present) | Re-trigger generation (the existing `POST /api/pipeline/[meetingId]/retrigger`) |
| **`retranscribe`** | transcript missing **or** `status=failed`, **but** a recording exists (`recording.status=done`, any media present) | **Request ASYNC transcription on the existing recording, then generate.** ← the Leap Metrics case |
| **`unrecoverable`** | no recording at all (silent / never-admitted / too-short bot) | None — show the reason, don't offer a dead button |

- Surface the **actual sub_code/reason** on the row (e.g. "transcription failed — provider connection"), never a generic "failed".
- Re-triggering generation on a `retranscribe` meeting just fails again — the UI must not offer it.

### 3.4 SELF-HEALING (the operator will not always be around) — **required, 2026-07-21**
A dashboard button still needs a human to press it. The system must recover **unattended**:
- **Worker auto-retry:** extend the existing transcript watchdog so that when a meeting is stuck (`bot_dispatched` + `NOT transcript_received`) and Recall reports the transcript **missing/failed while a recording exists**, the worker **automatically requests async transcription** on that recording, then lets the normal `transcript.done` → generate path run. This turns today's incident into a non-event.
- **Bound it:** cap automatic re-transcribe attempts per meeting (e.g. 2) with backoff; record attempts so a permanently-broken meeting can't loop or burn spend. Respect the same cost reality as §2.
- **Escalate only when it truly can't self-heal:** after the cap, flag `needs_attention` and fire the existing admin alert (P7 `emailAdminsForAlert`) with the reason — so a human is pulled in *by exception*, not by default.
- The Pipeline fleet view (§3.1) then shows mostly *self-healed* meetings, and the manual controls become the fallback for the genuinely stuck.

**Related root-cause fix (separate worker brief):** transcription currently uses `recallai_streaming` — a *real-time* provider holding a live connection per bot, which is what failed. Nothing in gracie consumes a live stream (we process post-meeting), so switching to an **async** provider removes this failure mode at the source; §3.4's auto-retry then covers whatever still slips through. Also pending there: dedupe bot dispatch on (`video_link` + start time) — two bots in one call (duplicate invites) is the suspected trigger for the double `provider_connection_failed`.

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
