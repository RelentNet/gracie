# Live meeting-bot controls — leave + pause/resume

**Status:** built, PR open, **HELD** for an operator decision (do not merge yet).

## What & why

On `/meetings/[id]`, while Gracie's bot is CURRENTLY in a live meeting (the
`in_session` state AND the meeting has a `bot_job_id`), a staffer can now:

1. **Remove Gracie from this meeting** — the bot leaves the call. Irreversible
   (it won't rejoin) → inline confirm before it fires.
2. **Pause recording ⇄ Resume recording** — a manual toggle. While paused, a loud
   persistent banner ("⏸ Recording is paused — Gracie is not capturing this
   meeting") sits above the controls so it can never be silently left paused.
   No timer / no auto-resume in this PR — a human at the dashboard clicks Resume.

These are pure Recall bot-API calls. They act on **any** bot and are **independent
of the transcript-provider / realtime kill-switch** — nothing here reads or writes
that setting.

## Operability

- One obvious button per action, plain language, safe default (page assumes
  recording on load).
- Remove is destructive → inline confirm ("Remove Gracie? She won't rejoin.").
- Pause is impossible to forget → the loud banner persists until Resume.
- Errors are plain-language ("Couldn't reach Gracie — try again.") and the pause
  toggle rolls back its optimistic state if the call fails.
- Available to any authenticated staffer (matches the "Send Gracie" re-dispatch,
  PR #90/#94) — no per-client permissions.

## Pieces

- **Shared helpers** — `packages/shared/src/recall/index.ts`: `leaveRecallBot`,
  `pauseRecallBot`, `resumeRecallBot` (+ private `postBotAction`), mirroring
  `createRecallAsyncTranscript`'s auth + throw-on-non-OK shape. Unit-tested with a
  mocked `fetch` in `apps/worker/src/lib/recall.test.ts`.
- **Routes** (web, `runtime = 'nodejs'`) — `POST /api/meetings/[id]/{leave,pause,resume}`,
  each a 3-line wrapper over the shared `apps/web/lib/meeting-bot-control.ts`
  (`runBotControl`): resolve the meeting (reuses `getMeetingForRetrigger`), 404 if
  no `bot_job_id`, resolve the Recall key (`getCredential('recall')`) + region
  (`RECALL_REGION`), call the helper, return `{ ok: true }`.
- **UI** — `apps/web/components/meetings/MeetingBotControls.tsx`, rendered in the
  in-session block of `apps/web/app/(app)/meetings/[id]/page.tsx`, gated on a
  non-empty `bot_job_id`.

## Not in scope / gaps

- No schema change. Paused state is client-side only (optimistic + reflects the
  API result); a page reload assumes recording.
- No auto-resume timer.
- **e2e gap:** the leave/pause/resume paths need a LIVE Recall meeting to exercise
  end-to-end, which dev can't produce. Helpers are unit-tested and the UI is
  reasoned through (matches the #78/#79 precedent).
