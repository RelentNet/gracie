# Delegation Brief — Meeting-occurrence page (clickable calendar → per-meeting detail)

> Self-contained brief for a fresh Claude Code session. Read §0–§1 first.
> **Platform:** macOS, Node 24, pnpm. Web `apps/web`, worker `apps/worker`, DB `packages/db`.
> **Branch + PR. Do NOT push to `main`.** Phased — ship Phase A alone first; later phases are additive.
> Captured 2026-07-20 from a planning conversation; grounded in the code as it stood then.

---

## 0. Goal (what the user asked for)
Every meeting on the calendar should be **clickable**, opening a page for **that specific occurrence**. The page is **status-adaptive** — it shows different things depending on whether the meeting is upcoming, currently recording, or already recorded:

- **Upcoming** → a brief built from the client's last 2–3 meetings (prep material).
- **In session (recording now)** → the same brief **plus** a "recording" indicator and a **live transcript** (and live video *if feasible* — see §3).
- **Recorded** → all **generated documents for that meeting**, its **tasks** + master-record entry, and a **player for the recording video**.

Think Otter.ai / any meeting-bot product: click a session, get status-appropriate data.

## 1. Why this is cheaper than it sounds (what already exists)
- **Per-meeting data + API:** `meetings` rows carry `pipeline_status` (`scheduled`/`processing`/`complete`/`needs_attention`), `bot_dispatched`, `bot_job_id`, `transcript_received`, `series_id` (recurring-series key), plus `/api/calendar/meetings/[id]` already exists. The calendar page already renders each meeting.
- **Docs keyed per occurrence:** every `documents` row has `meeting_id`, and (as of v0.2.2) a meeting's generated docs live in one occurrence folder `clients/<slug>/generated/<group>/<stamp>-<id8>/`. So "show the docs for this session" is one query — already the natural backing store for this page.
- **Briefs:** `pre_meeting_briefs` + `apps/worker/src/lib/brief.ts` `buildBriefContent()` already generate a brief from historical client context (used by the daily-sync). The "last 2–3 meetings" brief is a tuning of this, not new work.
- **Tasks / master record:** `tasks.source_meeting_id`, `master_record_entries.meeting_id` already scope to a meeting.

So **Phase A is mostly assembling data we already store**, not new plumbing.

## 2. Recall.ai capability findings (the real unknowns — verified against Recall's API)
The bot is dispatched via `@gracie/shared/recall` with `recording_config.transcript.provider`; today only the **post-meeting** path is used (`transcript.done` webhook → fetch `media_shortcuts.transcript.download_url` → generate). Real-time is all additive.

| Capability | Recall supports? | Effort | How |
|---|---|---|---|
| **"Recording now" status** | ✅ | **Easy** | Recall emits `bot.status_change` events (`joining_call` → `in_call_recording` → `call_ended` → `done`). We currently only subscribe to `transcript.done`; add the status events + store live state. |
| **Live transcript** | ✅ | **Moderate** | Recall streams real-time transcript to a configured realtime endpoint. Needs: enable it in the bot config, an ingest endpoint, and push to the browser (SSE). First realtime surface in the app. |
| **Post-meeting video player** | ✅ | **Moderate** | Recall keeps the recording (`media_shortcuts.video_mixed`). Fetch the URL at `transcript.done`/`recording.done`, download to MinIO (like transcripts), serve via presigned URL to an HTML5 player. Cost = video storage/egress. |
| **Live video during the call** | ⚠️ technically | **Hard / defer** | Real-time video relay (WebRTC/HLS) is heavy, latency-prone, costly. **Defer** or substitute periodic screenshots. "Recording now" + live transcript delivers ~90% of the value. |

## 3. Phased build order (ship A first; each later phase is independent)
- **Phase A — the page itself (core).** New route (e.g. `/meetings/[id]`); calendar meetings become links; status-adaptive shell (upcoming / in-session / recorded); surface existing **docs + tasks + master-record + brief**. **Medium effort, low risk.** Biggest UX win, leans on data we already store.
- **Phase B — live "recording" status.** Add `bot.status_change` handling to the Recall webhook + a live-state column (see §4.1). **Small.** Unlocks the in-session view.
- **Phase C — post-meeting video.** Pipeline fetches + stores the recording in MinIO; page gets a player. **Medium.** Independent of B/D.
- **Phase D — live transcript.** Realtime endpoint + SSE to browser + incremental render. **Medium-hard** (first realtime infra).
- **Phase E — live video.** **Defer / evaluate.** Likely screenshots instead of a live stream.

A + B alone is a compelling feature.

## 4. Decisions to settle before building
1. **Live meeting state:** a `meetings.live_state` column **vs.** a small `meeting_bot_events` table. Lean **table** — it's an audit trail and powers "joined at / recording since". Whichever: the Recall webhook currently only handles `transcript.done`; broadening it is fine for a feature PR (unlike the bugfix, which was told not to touch the contract).
2. **Video retention/cost:** recordings are large. Keep all, or N days? Store in MinIO (consistent with transcripts) **vs.** proxy Recall's URLs (which expire — so store is safer).
3. **Realtime transport:** SSE (simple, one-way — fine for transcript) vs. WebSocket. SSE almost certainly enough.
4. **Access control:** the page MUST honor the same client / `restricted`-folder visibility rules as Documents (docs/02 §D14). A viewer must not see a meeting/docs for a client they can't access.
5. **Recall plan check:** confirm real-time transcript + recording retention are on the current Recall tier/pricing before Phase C/D.

## 5. Relationship to the Pipeline rethink
This page is the **detail view** of one occurrence. The Pipeline page should become the **fleet view** (all runs, filterable, needs-attention pinned, re-trigger) — see `docs/plan/pipeline-fleet-view-and-recovery.md`. Don't build overlapping surfaces: Pipeline rows should **link into** this meeting page. Build the meeting page's Phase A and the Pipeline fleet view with that hand-off in mind.

## 6. Gate + safety
- Green gate: `pnpm -w typecheck` + `pnpm -w lint`; add tests for any new pure logic (status derivation, brief selection).
- Respect the kill-switch and webhook contract; Phase B's webhook change must keep `transcript.done` → generation working exactly as today.
- No secrets staged. Worker deploys separately from web.
