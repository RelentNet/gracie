-- 0013_meetings_retranscribe_attempts.sql — bound the self-heal transcript retry.
--
-- The transcript watchdog (fix/pipeline-selfheal-recovery, brief §3.4) now recovers
-- unattended: when a meeting is stuck (bot dispatched, no transcript) and Recall shows
-- a RECORDING exists but the transcript is missing/failed, the watchdog automatically
-- requests async transcription on the surviving recording (the GA/Leap Metrics
-- `provider_connection_failed` case). Without a bound that would loop every sweep and
-- burn transcription spend on a permanently-broken meeting.
--
-- This counter caps the AUTOMATIC re-transcribe attempts per meeting (worker default: 2,
-- one per 15-min watchdog sweep = coarse backoff). Once the cap is hit the watchdog stops
-- retrying, flags the meeting `needs_attention`, and emails the admins — escalation by
-- exception, not by default. A manual "Re-transcribe" from the Pipeline view is unbounded
-- (a human made the call).
--
-- Additive + idempotent (IF NOT EXISTS), NOT NULL DEFAULT 0 so every existing row starts
-- fresh (auto-backfilled to 0 at ALTER time — no separate UPDATE). Applies to the SHARED
-- dev+prod Supabase — apply ONLY in coordination with the orchestrator. Hand-add
-- `retranscribe_attempts` to packages/db/src/database.types.ts meetings Row/Insert/Update
-- (done in this change).

alter table meetings
  add column if not exists retranscribe_attempts integer not null default 0;
