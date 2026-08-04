-- 0014_meeting_media.sql — recorded video + synced transcript for the meeting page (Phase C).
--
-- After a meeting ends, the worker streams Recall's mixed-video MP4 into MinIO and
-- shapes the async transcript into timestamped segments (also stored in MinIO). This
-- table holds the object KEYS so the meeting-occurrence page can render an HTML5
-- <video> (served through the same-origin /api/files/raw proxy — never a raw Recall
-- URL) alongside a click-to-seek transcript.
--
-- One row per meeting (meeting_id PRIMARY KEY) — the worker UPSERTs it, so a re-run
-- never duplicates. Columns are individually nullable because the video and the
-- transcript can land independently / be missing:
--   video_key         MinIO key of the recording MP4 (null until/unless stored).
--   transcript_key    MinIO key of the transcript-segments JSON (null if no transcript).
--   video_duration_s  recording length in seconds from Recall metadata, else null.
--   fetched_at        when the worker last wrote this row.
--
-- Access control is inherited, not new: both keys live under the meeting's client
-- folder, so canAccessKey() (the /api/files/raw gate) governs them exactly like every
-- other object — a viewer who can't see the client can't fetch the media.
--
-- Retention: keep-all for now (MP4s are large — a retention/cleanup job is a tracked
-- follow-up, not part of this migration).
--
-- Additive + idempotent (create table if not exists). Applies to the SHARED dev+prod
-- Supabase — DO NOT apply unilaterally; apply ONLY in coordination with the
-- orchestrator (same handling as 0013). packages/db/src/database.types.ts is
-- hand-updated with the matching meeting_media Row/Insert/Update in this change.

create table if not exists meeting_media (
  meeting_id uuid primary key references meetings(id) on delete cascade,
  video_key text,
  transcript_key text,
  video_duration_s integer,
  fetched_at timestamptz not null default now()
);
