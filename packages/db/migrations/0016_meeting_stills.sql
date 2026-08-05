-- 0016_meeting_stills.sql — screen-share STILLS pinned inline in the transcript.
--
-- Team feedback: the only reason they want video is to see a graphic someone
-- screen-shared (an org chart). Rather than keep large MP4s, the worker extracts a
-- STILL FRAME at each slide/screen change (ffmpeg scene-change detection over the
-- Recall mixed video) and stores small JPEGs in MinIO. Each still carries its
-- timestamp (seconds from recording start) so the meeting page can pin it inline in
-- the transcript at the moment it appeared.
--
-- One row per still, MANY per meeting (hence a table, not more columns on
-- meeting_media). Columns:
--   meeting_id   the meeting this still belongs to (cascades on delete).
--   ts_seconds   seconds from recording start (aligns with transcript segment starts).
--   object_key   MinIO key of the JPEG. Lives UNDER the meeting's occurrence folder
--                (clients/<slug>/generated/.../<occurrence>/stills/…), so canAccessKey()
--                — the /api/files/raw gate — governs it exactly like every other object.
--
-- Retention: keep-all, DELIBERATELY. Stills are kilobytes and are the PERMANENT visual
-- record — they must OUTLIVE the 6-month Recall video expiry. No cleanup job.
--
-- Additive + idempotent (create table/index if not exists). Applies to the SHARED
-- dev+prod Supabase — DO NOT apply unilaterally; apply ONLY in coordination with the
-- orchestrator (same handling as 0013/0014). packages/db/src/database.types.ts is
-- hand-updated with the matching meeting_stills Row/Insert/Update in this change.

create table if not exists meeting_stills (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  ts_seconds integer not null,
  object_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists meeting_stills_meeting_id_idx on meeting_stills (meeting_id);
