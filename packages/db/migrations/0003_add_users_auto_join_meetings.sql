-- 0003_add_users_auto_join_meetings.sql (P4 — Calendar Integration)
--
-- Per-user "don't auto-join my meetings" opt-out (docs/09 Phase 4). The P4
-- bot-dispatch cron SKIPS a meeting when its `meeting_lead_user_id` has
-- `auto_join_meetings = false`, so a user can keep the Recall bot out of the
-- meetings they lead. Defaults to true (auto-join ON) so existing users and new
-- hires opt in by default; a per-user toggle in the Calendar UI flips it.
--
-- Depends on the base schema (docs/04-database-schema.sql) `users` table. Idempotent
-- via IF NOT EXISTS so re-applying is a no-op.
alter table users
  add column if not exists auto_join_meetings boolean not null default true;

comment on column users.auto_join_meetings is
  'P4: when false, the bot-dispatch cron skips meetings this user leads (per-user opt-out).';
