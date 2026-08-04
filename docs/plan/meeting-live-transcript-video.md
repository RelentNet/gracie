# Delegation Brief — Meeting page Phase C + D: recorded video + synced transcript, and live transcript

> Self-contained brief for a fresh Claude Code session. Extends `docs/plan/meeting-occurrence-page.md` (Phase A shipped in #69). This brief = **Phase C** (recorded video + click-to-seek transcript, after the meeting) + **Phase D** (live transcript, during the meeting). **Phase E (live video) stays deferred.**
> **Platform:** macOS, Node 24, pnpm. Web `apps/web`, worker `apps/worker`, DB `packages/db`. **Branch + PR. Do NOT push to `main`.**

---

## 0. The goal (operator, 2026-08-03)
Make each meeting's occurrence page work like the **Recall.ai dashboard player**: a recorded video with the transcript beside it, where **clicking a transcript line jumps the player to that moment**, and the active line highlights as it plays. During a live meeting, show the **transcript streaming in as it happens** (Otter-style).

## 1. Recall capability findings (researched 2026-08-03 — the key unknowns, now known)
**Recall does NOT provide an embeddable/hosted player.** It gives you the raw pieces and you build the UI:
- **Video:** raw **MP4 URLs** — S3 signed, **expire after ~5 hours**. No player widget. ([docs.recall.ai/docs/video-playback](https://docs.recall.ai/docs/video-playback))
- **Transcript:** **timestamped, per-speaker** ("who said what"), available **async** (post-call) and **real-time via websocket** (`wss://meeting-data.bot.recall.ai/api/v1/transcript`, `transcript.data` events; signed with the workspace verification secret). ([docs.recall.ai/docs/bot-real-time-transcription](https://docs.recall.ai/docs/bot-real-time-transcription))

So the "click text → seek" experience is a **standard component we build**: an HTML5 `<video>` + transcript segments carrying start-times; click a line → `video.currentTime = t`; highlight the active line on `timeupdate`. Not a big lift — Recall hands us the timestamps and the video.

**Synergy with what already exists:** the same-origin file proxy `/api/files/raw` + MinIO storage shipped in **#72**. Phase C rides that exact infra (store the MP4 in MinIO, serve via the proxy) — no MinIO exposure, no 5-hour expiry, per-request auth.

## 2. Phase C — recorded video + synced transcript (AFTER the meeting) — build FIRST
Lower risk; reuses infra we already have.
- **Ingest (worker):** at `recording.done` (already handled), fetch the video MP4 URL and **download it into MinIO** (dodge the 5h expiry; same pattern as transcripts). Persist the object key on the meeting (a column, or a small `meeting_media` table — see §4).
- **Serve (web):** stream the MP4 via the existing **`/api/files/raw`** proxy (#72) — same-origin, `canAccessKey`-gated, no expiry. Do NOT hand the browser a Recall URL (it expires + it's cross-origin).
- **Player (web, meeting page ended-state from #69):** HTML5 `<video>` playing the MinIO-served MP4, transcript beside it. Each transcript segment renders with its start time; **click → seek**; highlight the active segment on `timeupdate`. Graceful empty state if the video is still downloading ("Recording still processing").
- **Transcript source:** the async transcript we already fetch has **segment timestamps + speaker** — store/serve it structured (segments: `{start, end, speaker, text}`) so the synced UI can bind to it.
- **Access control:** reuse #69's visibility gate (`canAccessKey` / restricted-folder rules). A viewer who can't see the client can't see the video/transcript.

## 3. Phase D — live transcript (DURING the meeting) — build SECOND
First realtime infra in the app; keep it isolated behind the bot config.
- **Bot config:** enable Recall's **real-time transcript** on the bot.
- **Ingest (worker):** consume Recall's realtime transcript (`transcript.data` utterances) — via the websocket or Recall pushing to an endpoint; **verify the signature** with the workspace secret. Relay utterances to the browser.
- **Browser (meeting page in-session state from #69):** subscribe via **SSE** (one-way, simple — enough for transcript) to a live-transcript stream endpoint; append utterances live, Otter-style.
- **Public-edge note:** streaming through the public path needs NPM `proxy_buffering off` (already a tracked follow-up) — the code sets `X-Accel-Buffering: no`, but NPM must honor it.

## 4. Decisions to settle before building
1. **Video storage + retention:** MP4s are large. Keep how long in MinIO? Set a retention/cleanup (a Recall-side retention is also a tracked follow-up). Column on `meetings` vs a `meeting_media` table — lean **table** (video key + transcript-json key + durations + fetched_at), room for Phase E later.
2. **Realtime transport:** SSE (recommended, one-way) vs WebSocket. SSE almost certainly enough for transcript.
3. **Recall tier check:** confirm real-time transcript + recording retention are on our current Recall plan/pricing before Phase C/D.
4. **Live-transcript persistence:** show live only, then rely on the final **async** transcript as the canonical stored record? (Recommended — avoids double-writing; the async transcript is already the record.)

## 5. Phased order + gate
- **Ship Phase C first** (video + synced player — reuses #72 proxy + the async transcript we already fetch), **then Phase D** (live transcript — new realtime infra). Each is an independent PR.
- Green gate: `pnpm -w typecheck` + `pnpm -w lint`; worker tests; add tests for any new pure logic (transcript-segment shaping, seek/highlight helpers). Preview-verify the player (click-to-seek, active-line highlight) against a real recorded meeting.
- Reuse #69's access control verbatim. Worker + web deploy separately; a `recording.done` video-fetch change is worker-side.

## 6. ⭐ Operability constraint
Non-technical staff, no engineer: the player must degrade gracefully (video still processing / no recording), plain-language states, and never expose a raw Recall/MinIO URL to the browser. Reuse the #72 proxy so the "built to outlive us" storage story stays intact.
