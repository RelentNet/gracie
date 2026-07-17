-- 0011_backfill_generated_folder_names.sql — backfill display names for legacy
-- single-meeting generated-docs folders (fix/meeting-folder-collision).
--
-- Context: before this fix, the worker filed a meeting's generated docs into a
-- date-only folder `clients/<slug>/generated/<YYYY-MM-DD>` whose display_name was
-- the bare date. The fix switches NEW folders to a per-meeting, ET-stamped path
-- (`.../generated/<YYYYMMDD-HHMM>-<title-slug>-<id8>`) with a readable display_name
-- ("<Meeting Title> YYYYMMDD-HHMM"). This migration improves the display_name of
-- the OLD date folders so the file browser reads meaningfully — WITHOUT touching
-- any path or r2_key (rewriting those would orphan the stored MinIO objects).
--
-- Scope (data-only, no schema change, no types regen):
--   * Only legacy date folders — path matches `clients/<x>/generated/<YYYY-MM-DD>`
--     exactly (the `$`-anchored regex excludes the new per-meeting folders, which
--     carry extra `-<slug>-<id8>` after the stamp, and the parent `.../generated`).
--   * Only SINGLE-meeting folders — every document in the folder shares exactly one
--     non-null meeting_id. COLLIDED folders (docs spanning >1 meeting_id — the ones
--     whose objects were already overwritten/merged and cannot be split) are LEFT
--     UNTOUCHED on purpose.
--   * display_name becomes "<meeting title> <YYYYMMDD-HHMM ET>" (ET via
--     `date_time AT TIME ZONE 'America/New_York'`, matching the worker's easternStamp).
--
-- Idempotent (re-running sets the same value) + additive. Historical r2_keys and
-- folder paths are never modified. Depends only on the base `folders`/`documents`/
-- `meetings` tables. Applies to the SHARED dev+prod Supabase — apply ONLY in
-- coordination with the orchestrator. DO NOT APPLY from the coding session.

with folder_meeting as (
  -- Folders whose documents all resolve to exactly one non-null meeting_id.
  select
    d.folder_id,
    count(distinct d.meeting_id) as meeting_count,
    min(d.meeting_id) as meeting_id
  from documents d
  where d.folder_id is not null
    and d.meeting_id is not null
  group by d.folder_id
),
targets as (
  select
    fm.folder_id,
    coalesce(nullif(btrim(m.title), ''), 'Meeting') as title,
    to_char(m.date_time at time zone 'America/New_York', 'YYYYMMDD-HH24MI') as stamp
  from folder_meeting fm
  join folders f on f.id = fm.folder_id
  join meetings m on m.id = fm.meeting_id
  where fm.meeting_count = 1
    and f.path ~ '^clients/[^/]+/generated/[0-9]{4}-[0-9]{2}-[0-9]{2}$'
)
update folders f
set display_name = t.title || ' ' || t.stamp
from targets t
where f.id = t.folder_id
  and f.display_name is distinct from (t.title || ' ' || t.stamp);
