/**
 * Bot-dispatch processor (P4, docs/07 §1, docs/09 Phase 4). A tight repeatable
 * sweep (~60s) that dispatches exactly ONE Recall bot per due meeting:
 *
 *   select meetings starting within the lead window that are client-assigned, have
 *   a join URL, are still `scheduled`, and whose lead has NOT opted out →
 *   atomically claim (flip `bot_dispatched` false→true) → dispatch the Recall bot →
 *   store `bot_job_id`. On dispatch failure the claim is rolled back so the next
 *   sweep retries.
 *
 * P4's job ENDS here. When the meeting ends, Recall calls the already-built
 * `POST /api/webhooks/recall` (P5b), which matches by `bot_job_id` and runs
 * generation. This processor never touches transcripts or documents.
 *
 * Exactly-once: the claim is a conditional UPDATE (`… WHERE bot_dispatched =
 * false`), which is atomic at the row level — two overlapping sweeps can't both
 * claim the same meeting, so a client is never joined by two bots.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getCredential, getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';
import type { BotDispatchJobPayload } from '@gracie/shared';

import { BOT_DISPATCH_GRACE_MINUTES, BOT_DISPATCH_LEAD_MINUTES } from '../lib/calendar-config.js';
import { dispatchRecallBot } from '../lib/recall.js';

/**
 * Global kill-switch for bot dispatch (safety-critical, P4). Stored as a
 * `settings` row; dispatch runs ONLY when the value is exactly the string
 * 'true'. Any other value — including a missing row — leaves bots OFF, so a
 * fresh deploy with no setting is fail-safe (no client is ever auto-joined
 * until an Admin explicitly opts in). Gates ONLY dispatch; calendar-scan keeps
 * populating meetings so the operator can preview before enabling.
 */
const BOT_DISPATCH_ENABLED_SETTING_KEY = 'calendar_bot_dispatch_enabled';

/** Outcome of one dispatch sweep (visible in Bull Board). */
export interface BotDispatchResult {
  readonly scanned: number;
  readonly dispatched: number;
  readonly skippedOptOut: number;
}

/** Build the bot-dispatch processor, logging through the worker's Fastify logger. */
export function createBotDispatchProcessor(
  logger: FastifyBaseLogger,
): Processor<BotDispatchJobPayload, BotDispatchResult> {
  return async (job: Job<BotDispatchJobPayload>): Promise<BotDispatchResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const now = Date.now();

    const graceStart = new Date(now - BOT_DISPATCH_GRACE_MINUTES * 60_000).toISOString();
    const leadEnd = new Date(now + BOT_DISPATCH_LEAD_MINUTES * 60_000).toISOString();

    // Candidates: due, client-assigned, joinable, still scheduled, not dispatched.
    const { data: candidates, error } = await db
      .from('meetings')
      .select('id, video_link, meeting_lead_user_id, client_id, title')
      .eq('bot_dispatched', false)
      .eq('pipeline_status', 'scheduled')
      .not('client_id', 'is', null)
      .not('video_link', 'is', null)
      .gte('date_time', graceStart)
      .lte('date_time', leadEnd);
    if (error !== null) throw new Error(`bot-dispatch: scan meetings: ${error.message}`);

    const due = candidates ?? [];

    // Global kill-switch: gate the whole dispatch phase up front (fail-safe OFF).
    // The scan still runs on its own cron, so meetings keep populating for preview.
    if (!(await isBotDispatchEnabled(db))) {
      log.info({ scanned: due.length }, 'bot-dispatch: globally disabled');
      return { scanned: due.length, dispatched: 0, skippedOptOut: 0 };
    }

    if (due.length === 0) return { scanned: 0, dispatched: 0, skippedOptOut: 0 };

    // Per-user opt-out: leads who set auto_join_meetings = false.
    const optedOut = await loadOptedOutLeads(db);

    // Resolve the Recall key once (stored credential → env fallback).
    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      log.warn('bot-dispatch: no Recall API key configured (Admin → API Settings) — skipping sweep');
      return { scanned: due.length, dispatched: 0, skippedOptOut: 0 };
    }
    const region = process.env.RECALL_REGION;

    let dispatched = 0;
    let skippedOptOut = 0;

    for (const meeting of due) {
      if (meeting.meeting_lead_user_id !== null && optedOut.has(meeting.meeting_lead_user_id)) {
        skippedOptOut += 1;
        log.info({ meetingId: meeting.id }, 'bot-dispatch: lead opted out — skipping');
        continue;
      }
      if (meeting.video_link === null) continue; // narrowed by the query, re-checked for TS

      // Atomically claim: flip false→true; a 0-row result means another sweep won.
      const claim = await db
        .from('meetings')
        .update({ bot_dispatched: true })
        .eq('id', meeting.id)
        .eq('bot_dispatched', false)
        .select('id');
      if (claim.error !== null) throw new Error(`bot-dispatch: claim meeting: ${claim.error.message}`);
      if ((claim.data ?? []).length === 0) continue; // already claimed elsewhere

      try {
        const botJobId = await dispatchRecallBot({ meetingUrl: meeting.video_link, apiKey, region });
        const stored = await db.from('meetings').update({ bot_job_id: botJobId }).eq('id', meeting.id);
        if (stored.error !== null) throw new Error(stored.error.message);
        dispatched += 1;
        log.info({ meetingId: meeting.id, botJobId }, 'bot-dispatch: Recall bot dispatched');
      } catch (dispatchError) {
        // Roll back the claim so the meeting is retried on the next sweep. Awaiting
        // the builder resolves (never rejects) with an { error } shape, so a failed
        // rollback can't mask the original dispatch error.
        const rolledBack = await db
          .from('meetings')
          .update({ bot_dispatched: false })
          .eq('id', meeting.id);
        const message = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        log.error(
          { meetingId: meeting.id, err: message, rollbackError: rolledBack.error?.message },
          'bot-dispatch: dispatch failed — rolled back claim',
        );
      }
    }

    const result: BotDispatchResult = { scanned: due.length, dispatched, skippedOptOut };
    if (dispatched > 0 || skippedOptOut > 0) log.info(result, 'bot-dispatch sweep complete');
    return result;
  };
}

/**
 * Read the global bot-dispatch kill-switch. Enabled ONLY when the setting value
 * is exactly the string 'true'; a missing row or any other value = disabled
 * (fail-safe). See BOT_DISPATCH_ENABLED_SETTING_KEY.
 */
async function isBotDispatchEnabled(db: ServerClient): Promise<boolean> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', BOT_DISPATCH_ENABLED_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`bot-dispatch: read kill-switch: ${error.message}`);
  return data?.value === 'true';
}

/** Set of user ids who have opted out of auto-join (auto_join_meetings = false). */
async function loadOptedOutLeads(db: ServerClient): Promise<Set<string>> {
  const { data, error } = await db.from('users').select('id').eq('auto_join_meetings', false);
  if (error !== null) throw new Error(`bot-dispatch: load opt-outs: ${error.message}`);
  return new Set((data ?? []).map((u) => u.id));
}
