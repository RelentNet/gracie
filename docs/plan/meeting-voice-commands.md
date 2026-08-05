# In-meeting voice commands — leave + timed pause

**Status:** built, PR open, **HOLD — do not merge** (pending operator decision after the Allie call).
**Branch:** `feat/meeting-voice-commands`. Additive only — no migration.

## What it does

A meeting **host** can control Gracie's bot by speaking:

- "Hey Gracie, **leave the meeting**" → the bot leaves the call.
- "Hey Gracie, **stop listening for 5 minutes**" → the bot pauses recording and auto-resumes after N minutes.

Built entirely on the existing realtime-transcript pipeline (#79). Recall already pushes
each spoken utterance to our transcript webhook; we now also scan that text for a command.

## Exactly what a user says

- **Wake phrase** (STT-tolerant, case/punctuation-insensitive): `hey gracie`, `gracie ai`,
  `gracie`, or `grace` (Recall's ASR routinely drops the "-ie").
- **Leave:** any of "leave", "leave the meeting", "leave the call", "you can leave now"
  after the wake phrase.
- **Pause:** "pause", "stop listening", "stop recording", optionally "for N minutes"
  (digits or common words like "fifteen"). N defaults to **5**, clamped **1–60**.
- If both a leave and a pause verb appear, **leave wins** (leaving also stops recording).
- A wake phrase with no command, or the firm name "Grace & Associates" on its own, does
  **nothing**.

## Safety gates (all must pass before anything happens)

1. **Both switches on.** Inert unless realtime transcript **and** the new `voiceCommands`
   toggle are both ON. Both default OFF. If we aren't receiving realtime utterances at all,
   there is nothing to detect.
2. **Host-only.** We act only on a participant Recall marks `is_host`. Guests and clients
   are ignored. **Limitation:** `is_host` is a per-platform flag; if the meeting platform
   does not report it, `is_host` is absent and we **fail safe (do nothing)** rather than
   guess. We also surface the participant email when present (rare on realtime) for logging,
   but the acted-on signal is `is_host`.
3. **Visible confirmation.** Before acting, Gracie posts a one-line note in the meeting chat
   ("Gracie is leaving at a participant's request." / "Gracie will stop recording for N
   minutes.") so nothing happens silently.
4. **Debounce.** STT emits the same utterance several times in a row; a 30-second per-
   meeting+command Redis claim collapses duplicates to one action. Distributed, so two web
   replicas can't both fire.

## The transcript-reliability trade-off (the core decision)

Voice commands **require realtime transcript**, and realtime has a known cost: Recall allows
**one transcript provider per recording**, so turning realtime on switches the bot to the
streaming provider and **supersedes the reliable after-the-meeting (async) transcript** — the
same trade-off documented in `packages/shared/src/recall/index.ts` and the existing realtime
kill-switch. The streaming provider is also the one that failed a real client meeting once
(`provider_connection_failed`, GA/Leap Metrics, 2026-07-21). **Enabling voice commands means
accepting that transcription-reliability trade-off.** This PR does not try to "fix" it — it
documents it and keeps everything behind default-OFF switches.

## The observe-only assurance changes when this is on

Settings → Meeting Bot has a **locked "Observe-only" assurance**: "Gracie never chats,
speaks, or reacts in a meeting." Voice commands break that literal promise — the bot posts a
chat confirmation. The panel now shows an **honest, conditional** assurance: when voice
commands are on it reads "Observe-only, with one exception… the only thing she ever posts is a
one-line chat note confirming a host's voice command." She still never speaks aloud or joins
the conversation. **This is a real product decision for the Allie call**, not just an
implementation detail.

## How the pause resume works

Pause schedules a **BullMQ delayed job** (`resume-recording` queue) N minutes out. BullMQ
persists the delay in Redis, so the resume fires on time even across a worker restart — a
plain `setTimeout` would be lost. Resuming an already-resumed/ended bot is a harmless no-op:
the processor logs and completes rather than retrying.

## Files

Shared (pure, unit-tested):
- `packages/shared/src/recall/voice-commands.ts` — `parseVoiceCommand`, `parseRealtimeParticipant`.
- `packages/shared/src/recall/index.ts` — `leaveRecallBot`, `pauseRecallBot`, `resumeRecallBot`,
  `sendRecallChatMessage` (mirror `createRecallAsyncTranscript`); re-exports voice-commands.
- `packages/shared/src/constants/queues.ts`, `packages/shared/src/types/job.ts` — `resume-recording`
  queue/job + `ResumeRecordingJobPayload`.

DB / settings:
- `packages/db/src/bot-config.ts` — `voiceCommands` field (default OFF).
- `apps/web/app/api/settings/bot/route.ts` — validate/expose `voiceCommands`.
- `apps/web/app/(app)/settings/BotSettingsPanel.tsx` — toggle + plain-language warning +
  honest observe-only assurance.

Web wiring:
- `apps/web/lib/voice-commands.ts` — the fire-and-forget handler (config + host gate +
  debounce + confirm + act).
- `apps/web/app/api/webhooks/recall/transcript/route.ts` — one `void handleVoiceCommand(...)`
  call; the ack still returns in ms.
- `apps/web/lib/live-transcript.ts` — `claimOnce` debounce helper (reuses the web Redis conn).
- `apps/web/lib/queue.ts` — `enqueueResumeRecording` (delayed job producer).

Worker:
- `apps/worker/src/queues/resume-recording.queue.ts`, `.../processors/resume-recording.processor.ts`,
  wired in `apps/worker/src/index.ts`.

Tests:
- `apps/worker/src/lib/voice-commands.test.ts` — parser hits/misses/near-misses, host gate,
  and the four bot-control HTTP shapes.

## Gates

- `pnpm -r typecheck` clean · `pnpm -r lint` clean · `pnpm --filter web build` clean.
- `pnpm --filter @gracie/worker test` — 146/146 (20 new).

## E2E gap

Real end-to-end needs a **live Recall meeting with realtime on**, which isn't available in
dev. The pure logic (parser, host gate, HTTP shapes) is unit-tested thoroughly; the live path
(Recall actually leaving/pausing, chat posting) is unverified until a real meeting.

## Deferred / known ceilings

- Word-number durations cover common values only (digits always work). Default 5m otherwise.
- Two genuine "pause for N" commands more than 30s apart schedule independent resumes; the
  earlier resume can un-pause first. The debounce covers the real problem (STT repeats).
- Resume is best-effort (no retry). A transient Recall blip at the exact resume instant loses
  the tail of the recording — acceptable for a rare, opt-in nicety.

## Overlap note

A sibling **bot-controls PR** is expected to add the same `leaveRecallBot` / `pauseRecallBot` /
`resumeRecallBot` helpers with identical signatures. Whichever merges second should drop the
duplicate helpers and keep one definition in `packages/shared/src/recall/index.ts`.
