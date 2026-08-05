-- 0016_users_timezone.sql — per-user profile timezone.
--
-- The app UI renders in the viewer's DEVICE/browser-local timezone; this column
-- is the SERVER-SIDE fallback: it timezones the daily-sync EMAIL (server-rendered,
-- can't read the device at open) and any SSR-rendered timestamp. Holds an IANA zone
-- id (e.g. "America/Chicago"); NULL → fall back to "America/New_York". Defaulted
-- from the browser on first app load (a self-service PATCH) and overridable from
-- the Calendar page's "Your timezone" control.
--
-- Additive + idempotent (add column if not exists). Applies to the SHARED dev+prod
-- Supabase — DO NOT apply unilaterally; apply ONLY in coordination with the
-- orchestrator (same handling as 0013/0014/0015). packages/db/src/database.types.ts
-- is hand-updated with the matching users.timezone Row/Insert/Update column.

alter table users add column if not exists timezone text;
