/**
 * Transcript watchdog processor (P5b, docs/06 §8). A repeatable sweep: any meeting
 * whose bot was dispatched but whose transcript has not arrived within
 * `TRANSCRIPT_TIMEOUT_MINUTES` is flagged `needs_attention` and the meeting lead
 * gets an in-app `needs_attention` notification so they can dismiss or upload the
 * transcript manually.
 *
 * P7 follow-up (TODO): docs/06 §8 also calls for a Resend email alert to the lead.
 * Resend is not configured until P7 — this does in-app + log only for now.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import { TRANSCRIPT_TIMEOUT_MINUTES, type WatchdogJobPayload } from '@gracie/shared';

type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

/** Outcome of one watchdog sweep (visible in Bull Board). */
export interface WatchdogResult {
  readonly scanned: number;
  readonly flagged: number;
}

/** Pipeline states a meeting can be stuck in while still awaiting a transcript. */
const WAITING_STATES = ['awaiting_transcript', 'scheduled', 'in_progress'] as const;

/** Insert a `needs_attention` notification for the lead (or attendees as fallback). */
async function notifyLead(
  db: ServerClient,
  meeting: {
    id: string;
    title: string | null;
    meeting_lead_user_id: string | null;
    attendee_user_ids: string[];
    client_id: string | null;
  },
): Promise<void> {
  const recipients =
    meeting.meeting_lead_user_id !== null
      ? [meeting.meeting_lead_user_id]
      : meeting.attendee_user_ids;
  if (recipients.length === 0) return;

  const label = meeting.title ?? 'a meeting';
  const link = meeting.client_id !== null ? `/clients/${meeting.client_id}` : null;
  const rows: NotificationInsert[] = recipients.map((userId) => ({
    user_id: userId,
    type: 'needs_attention',
    title: `Transcript overdue for ${label}`,
    body: `No transcript arrived within ${TRANSCRIPT_TIMEOUT_MINUTES} minutes. Review or upload it manually.`,
    link,
  }));
  const { error } = await db.from('notifications').insert(rows);
  if (error !== null) throw new Error(`watchdog: insert notifications: ${error.message}`);
}

/** Build the watchdog processor, logging through the worker's Fastify logger. */
export function createWatchdogProcessor(
  logger: FastifyBaseLogger,
): Processor<WatchdogJobPayload, WatchdogResult> {
  return async (job: Job<WatchdogJobPayload>): Promise<WatchdogResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const cutoff = new Date(Date.now() - TRANSCRIPT_TIMEOUT_MINUTES * 60_000);

    const { data, error } = await db
      .from('meetings')
      .select('id, title, meeting_lead_user_id, attendee_user_ids, client_id, pipeline_started_at, date_time')
      .eq('bot_dispatched', true)
      .eq('transcript_received', false)
      .in('pipeline_status', WAITING_STATES);
    if (error !== null) throw new Error(`watchdog: scan meetings: ${error.message}`);

    const candidates = data ?? [];
    // A meeting is overdue if its reference time (pipeline start, else scheduled
    // start) is older than the SLA cutoff.
    const stale = candidates.filter((m) => {
      const reference = m.pipeline_started_at ?? m.date_time;
      return new Date(reference) < cutoff;
    });

    let flagged = 0;
    for (const meeting of stale) {
      const patched = await db
        .from('meetings')
        .update({ pipeline_status: 'needs_attention' })
        .eq('id', meeting.id);
      if (patched.error !== null) {
        throw new Error(`watchdog: flag meeting ${meeting.id}: ${patched.error.message}`);
      }
      await notifyLead(db, meeting);
      flagged += 1;
      log.warn({ meetingId: meeting.id }, 'watchdog: transcript overdue → needs_attention');
    }

    if (flagged > 0 || candidates.length > 0) {
      log.info({ scanned: candidates.length, flagged }, 'watchdog sweep');
    }
    return { scanned: candidates.length, flagged };
  };
}
