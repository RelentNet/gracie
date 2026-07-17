-- 0011_meetings_series_id.sql — stable recurring-series key for folder grouping.
--
-- Generated-doc folders group a meeting's docs under a per-SERIES folder so every
-- occurrence of a recurring meeting nests together (fix/meeting-folder-collision).
-- The group must key off the SERIES, not the title (titles get edited; two distinct
-- series can share a title), and must be stable across the different staff mailboxes
-- the calendar scan reads.
--
-- `meetings.calendar_event_id` already stores `ical:<iCalUId>`, and for Outlook the
-- iCalUId is a Global Object ID: a fixed 16-byte header, then 4 bytes encoding the
-- per-OCCURRENCE instance date, then a GUID tail that is IDENTICAL for every
-- occurrence of one series AND across mailboxes. Zeroing the 4 instance-date bytes
-- yields the series master id (the "clean" GOID) — the ideal group key, with no
-- extra Graph call. (Microsoft's own CleanGlobalObjectId does exactly this zeroing.)
--
-- series_id is therefore a STORED generated column derived from calendar_event_id:
--   * only for Outlook GOIDs (header match + long enough), and
--   * only for actual recurrence occurrences — the instance-date bytes are non-zero
--     (they are all-zero for single appointments and series masters), so singles and
--     non-Outlook ids get NULL (→ the generate processor falls back to title grouping).
-- Validated on live data: e.g. "Daily Sync" (53 occurrences) collapses to ONE
-- series_id, and same-titled-but-distinct series ("Allie & Daniel", "GA/Leap Metrics")
-- correctly split into separate keys.
--
-- Offsets (1-indexed): calendar_event_id = 'ical:'(5) + hex. In the hex, chars 1-32
-- are the header, 33-40 the instance-date bytes → in calendar_event_id those are
-- positions 6-37 and 38-45. series_id stores the clean hex (no 'ical:' prefix).
--
-- STORED generated column: computed for all existing rows at ALTER time (auto
-- backfill, no separate UPDATE) and on every future insert/upsert — it can never
-- drift from calendar_event_id, and the calendar scan needs NO code change (the
-- column is read-only; writes to it are rejected). Immutable expression only
-- (like/length/substr/overlay), as generated columns require.
--
-- Additive + idempotent (IF NOT EXISTS). Data-only for existing rows (no rewrite of
-- any r2_key/path). Applies to the SHARED dev+prod Supabase — apply ONLY in
-- coordination with the orchestrator. Hand-add `series_id` to
-- packages/db/src/database.types.ts meetings.Row (done in this change); Insert/Update
-- mark it `never` since it is generated.

alter table meetings
  add column if not exists series_id text
  generated always as (
    case
      when calendar_event_id like 'ical:040000008200E00074C5B7101A82E008%'
       and length(calendar_event_id) > 45
       and substr(calendar_event_id, 38, 8) <> '00000000'
      then overlay(substr(calendar_event_id, 6) placing '00000000' from 33 for 8)
      else null
    end
  ) stored;

-- Speeds "all meetings in this series" lookups (folder grouping + future features).
create index if not exists idx_meetings_series_id
  on meetings (series_id)
  where series_id is not null;
