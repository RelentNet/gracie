# 6-month video retention + graceful expiry fallback

Operator decision: meeting **video is retained 6 months (rolling)**. After that the
transcript + screen-share stills (#104) remain as the permanent record. Two changes.

## 1. Set Recall recording retention (~180 days) on every bot dispatch

`packages/shared/src/recall/index.ts`:

- New named constants:
  - `VIDEO_RETENTION_DAYS = 180`
  - `RECORDING_RETENTION_CONFIG = { type: 'timed', hours: VIDEO_RETENTION_DAYS * 24 }` (4320h)
- `dispatchRecallBot` now merges `retention` into `recording_config`, **composed with**
  the existing `SCREEN_SHARE_RECORDING_CONFIG` + transcript/realtime config (nothing
  clobbered — `retention` is a new sibling key alongside `video_mixed_layout`/`transcript`):

  ```ts
  recording_config: {
    ...SCREEN_SHARE_RECORDING_CONFIG,     // video_mixed_layout, ...
    retention: RECORDING_RETENTION_CONFIG, // { type: 'timed', hours: 4320 }
    ...(recordingConfig ?? {}),            // transcript, realtime_endpoints
  }
  ```

### Recall field used + doc source

- **Field:** `recording_config.retention`, shape `{ type: "timed", hours: <N> }`
  (the only other allowed value is `{ type: "forever" }`). Recall counts retention in
  **hours**, so 180 days = 4320h.
- **Source:** Recall docs — "Storage and Data Retention"
  (https://docs.recall.ai/docs/storage-and-playback). Verified the exact field name +
  shape there before use, the same way the screen-share fields were verified.
- Note: Recall's default retention is now **forever** (post-2025-06-12), i.e. media never
  expires by default and storage is billed. Setting a bounded 180-day retention is what
  actually makes the "6-month rolling" policy real.

Tests updated (`apps/worker/src/lib/recall.test.ts`): both `dispatchRecallBot` shape
tests now assert `recording_config.retention === { type: 'timed', hours: 4320 }`, plus a
constant sanity test. Worker suite 173/173.

## 2. Graceful expiry fallback (open item #2)

The meeting page live-pulls a **fresh** Recall signed video URL server-side per view
(#80). The server can't know a URL will 404 without downloading it, so once a recording's
retention lapses the browser gets a URL that **404s on load** — previously an erroring
`<video>`.

- `apps/web/components/meetings/MeetingRecording.tsx`: added an `onError` handler on the
  `<video>` that sets `videoFailed`; `videoAvailable = videoUrl !== null && !videoFailed`
  gates the player. When the video isn't available (server returned no URL **or** it
  404'd client-side) the component drops to the existing transcript-only full-width
  layout and shows: **"This recording has expired — the transcript and screen-share
  stills remain."** Transcript-line seek buttons are disabled when there's no playable
  video (`seekable = videoAvailable && …`).
- `apps/web/app/(app)/meetings/[id]/page.tsx`: `RecordingCard` no longer prints its own
  expiry sentence — the component is now the **single source of truth** for the expired
  message, so the server-known-null path and the client-404 path never contradict each
  other. The card keeps only the happy-path guidance; the "no longer available" empty
  state (nothing left at all) is unchanged.

### Why no `meeting-occurrence.ts` change

`resolveMeetingPlayback` already degrades correctly: it returns `videoUrl: null` when
Recall reports no recording, and its `try/catch` already falls back to the durable
transcript when the bot-retrieve throws (retention lapsed / bot gone). The only remaining
gap was the client-side 404 — unfixable server-side without a wasteful per-view HEAD
request — so it's handled in the player. Left untouched.

## Gate

`pnpm -r typecheck` ✅ · `pnpm -r lint` ✅ · worker tests 173/173 ✅ · web tests 55/55 ✅.
Additive only. No migration. No new dependency.
