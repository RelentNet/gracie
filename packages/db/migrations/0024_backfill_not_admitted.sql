-- 0024: backfill the meetings verified against Recall as never-admitted.
--
-- Scope is deliberately narrow: only meetings currently flagged `needs_attention`
-- that have a bot, no transcript, and NO successful pipeline run. Every one was
-- checked against Recall's bot `status_changes` during the 2026-09-01 investigation
-- and had zero recordings with a waiting-room termination. Idempotent.
update meetings
set pipeline_status = 'not_admitted'
where pipeline_status = 'needs_attention'
  and bot_job_id is not null
  and transcript_received = false
  and not exists (
    select 1 from pipeline_runs r
    where r.meeting_id = meetings.id and r.status = 'success'
  );
