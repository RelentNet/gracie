# Screen-share stills pinned inline in the transcript

## Why
Team feedback (Richard's org-chart example): the *only* reason staff want meeting
video is to see a graphic someone screen-shared. Video is large and expires at 6
months. So instead of leaning on video, capture the shared graphics as **still
frames** — kilobytes each, kept **forever** — and pin each one **inline in the
transcript** at the timestamp it appeared. Click a still to enlarge. After the video
expires, the stills + transcript remain the permanent visual record.

## Recall investigation (resolved)
- Recall exposes **no screen-share-only track**. `media_shortcuts` carries
  `video_mixed` (+ transcript/audio/events) only; "Retrieve Video Separate" is
  *per-participant*, not screen-share-isolated. There is no `video_mixed_screenshare`
  shortcut and no layout that yields a screen-share-only file.
- **Decision: use `video_mixed`** (what the existing player already streams), and shape
  it at dispatch so screen shares come through clean:
  - `recording_config.video_mixed_layout = 'speaker_view'` — shared screen is the
    full-frame dominant content (gallery would shrink it to a tile).
  - `recording_config.video_mixed_participant_video_when_screenshare = 'hide'` — drop
    camera tiles *while sharing*, so screen-share segments are clean full-screen
    graphics → better stills and far fewer scene-change false positives.
  Mixed video is on by default, so screen share was already captured; these fields
  only shape it. Both are confirmed real Recall fields (siblings of `transcript`).

## How it works
1. **Dispatch** (`packages/shared/src/recall/index.ts`): every bot now sends the
   `SCREEN_SHARE_RECORDING_CONFIG` merged into `recording_config`. `buildRecordingConfig`
   is unchanged (transcript/realtime only); the video layout is composed in at dispatch.
2. **Extraction** (`apps/worker/src/lib/stills.ts`): after `transcript.done` drives
   generation, the existing best-effort media step streams the mixed video from Recall's
   signed URL and runs **ffmpeg scene-change detection**
   (`select='gt(scene,0.4)',showinfo,scale=…`). Each selected frame's `showinfo`
   `pts_time` is its timestamp (seconds from recording start). Frames are downscaled
   (≤1280px, JPEG q5) to stay kilobytes. Nothing is downloaded whole.
   - **Bounded:** capped at **30 stills/meeting**, kept **evenly spaced** so a late slide
     (org chart at minute 55) is never lost to an early run of changes. Whole video is
     decoded (no early `-frames:v` cutoff) so late slides are reached; the final cap is
     applied in pure TS.
   - **Idempotent + cheap:** if a meeting already has stills, the expensive ffmpeg pass
     is skipped on re-runs.
   - **Best-effort:** wrapped so any failure (ffmpeg missing, bad stream) is logged and
     **never fails meeting generation** — the docs/transcript are already committed.
3. **Storage** (`generate.processor.ts` → `storeScreenShareStills`): JPEGs go to MinIO
   under the meeting's **occurrence folder** (`…/<occurrence>/stills/NNN-<ts>.jpg`), so
   `canAccessKey` governs them exactly like every other object. One `meeting_stills` row
   per still (`{meeting_id, ts_seconds, object_key}`). New additive table (migration
   0016). **Kept indefinitely** — not subject to video retention.
4. **Serve**: stills load through the same-origin `/api/files/raw` proxy (re-checks
   `canAccessKey` per fetch). No new access surface.
5. **Render** (`MeetingRecording.tsx` + meeting page): each still is pinned to the
   transcript line closest **at/before** its timestamp (`groupStillsBySegment`, reusing
   `activeSegmentIndex`); stills before the first timed line render above the transcript.
   Click a thumbnail → native `<dialog>` lightbox (Esc/backdrop to close). When the video
   has expired (`videoUrl === null`) the transcript + stills still render full-width as
   the permanent record.

## Data model
`meeting_stills` (migration `0016_meeting_stills.sql`, additive/idempotent). DB types
hand-regenerated in `packages/db/src/database.types.ts`. **Needs applying** to the shared
Supabase in coordination with the orchestrator (same handling as 0013/0014).

## Tests
- Pure, unit-tested: `parseSceneTimestamps`, `selectStills` (capping/even spacing),
  `groupStillsBySegment` (timestamp → transcript-line placement, incl. leading/untimed).
- Updated: the two `dispatchRecallBot` shape tests (recording_config now always carries
  the screen-share layout).
- **e2e gap:** the ffmpeg extraction itself can't run in CI — it needs a real Recall
  recording that contains a screen share. Verify post-deploy on a real meeting.

## Deploy notes
- **ffmpeg added to `apps/worker/Dockerfile`** → the worker image must be **rebuilt and
  redeployed** for stills to be captured. (Absence is handled gracefully — stills just
  won't appear.)
- Web needs a redeploy for the meeting-page rendering.
- Apply migration 0016.

## Deferred (YAGNI for v1)
- **False-positive elimination via `participant_events`:** gate extraction to actual
  screen-share intervals to drop the last speaker-switch false positives. `hide` +
  threshold already keeps these low; a future upgrade if clutter is a problem.
- A stills retention/cleanup job — not wanted (stills are the permanent record).
