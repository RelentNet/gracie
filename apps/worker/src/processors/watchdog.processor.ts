/**
 * Transcript watchdog processor (P5b, docs/06 §8) + SELF-HEAL (brief §3.4). A
 * repeatable sweep over meetings whose bot was dispatched but whose transcript
 * has not arrived within `TRANSCRIPT_TIMEOUT_MINUTES`.
 *
 * The watchdog no longer just flags: for each overdue meeting it runs a Recall
 * pre-flight (`classifyRecallRecoverability`) and self-heals the MECHANICAL cases
 * UNATTENDED — the whole point being that the operator will not always be around:
 *   - `regenerate`   — a transcript exists but generation never ran (missed webhook)
 *                      → enqueue generation.
 *   - `retranscribe` — a recording exists but the transcript is missing/failed (the
 *                      GA/Leap Metrics `provider_connection_failed` case) → request
 *                      async transcription on the surviving recording, then let the
 *                      normal `transcript.done` → generate path run. BOUNDED to
 *                      `MAX_RETRANSCRIBE_ATTEMPTS` per meeting (counter on `meetings`)
 *                      so a permanently-broken meeting can't loop or burn spend.
 *   - `unrecoverable` / cap reached → flag `needs_attention` + email the Admins
 *                      (P7 `emailAdminsForAlert`). Escalation BY EXCEPTION only.
 *
 * The in-app `needs_attention` notification still goes to the lead (or attendees);
 * only the alert email is admin-scoped.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getCredential, getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import {
  TRANSCRIPT_TIMEOUT_MINUTES,
  type GenerationJobPayload,
  type WatchdogJobPayload,
} from '@gracie/shared';

import { emailAdminsForAlert } from '../lib/email.js';
import {
  classifyRecallRecoverability,
  createRecallAsyncTranscript,
  type RecallRecoverability,
} from '../lib/recall.js';

type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];

/**
 * Cap on AUTOMATIC re-transcribe attempts per meeting (brief §3.4). The 15-min
 * watchdog interval spaces the attempts, so this doubles as coarse backoff.
 * ponytail: fixed spacing = watchdog interval; add a per-attempt timestamp + real
 * exponential backoff only if transcription latency ever makes 15-min too tight.
 */
const MAX_RETRANSCRIBE_ATTEMPTS = 2;

/** Plain-language escalation reasons (brief §6: no enum/provider codes as the headline). */
const RETRANSCRIBE_EXHAUSTED_REASON =
  'This meeting was recorded, but the notes couldn’t be created after several automatic tries. Review it or upload the notes manually.';
const NO_RECORDING_REASON =
  'No recording was captured for this meeting, so there’s nothing to turn into notes.';
const NO_TRANSCRIPT_REASON = `No transcript arrived within ${TRANSCRIPT_TIMEOUT_MINUTES} minutes. Review or upload it manually.`;

/** Outcome of one watchdog sweep (visible in Bull Board). */
export interface WatchdogResult {
  readonly scanned: number;
  /** Meetings escalated to `needs_attention` this sweep (couldn't self-heal). */
  readonly flagged: number;
  /** Meetings whose existing transcript was re-queued for generation. */
  readonly regenerated: number;
  /** Meetings for which async transcription was (re-)requested. */
  readonly retranscribed: number;
}

/** Pipeline states a meeting can be stuck in while still awaiting a transcript. */
const WAITING_STATES = ['awaiting_transcript', 'scheduled', 'in_progress'] as const;

/** The self-heal action for one overdue meeting, decided purely (exported for tests). */
export type WatchdogAction =
  | { readonly kind: 'regenerate' }
  | { readonly kind: 'retranscribe'; readonly recordingId: string }
  | { readonly kind: 'wait' }
  | { readonly kind: 'escalate'; readonly reason: string };

/**
 * Decide what to do with an overdue meeting from its Recall recoverability + how
 * many automatic re-transcribe attempts it has already had. Pure — the processor
 * performs the resulting DB/Recall/queue side effects.
 */
export function decideWatchdogAction(
  recoverability: RecallRecoverability,
  attempts: number,
  maxAttempts: number,
): WatchdogAction {
  switch (recoverability.state) {
    case 'regenerate':
      return { kind: 'regenerate' };
    case 'retranscribe':
      // A request is already in flight — wait, don't stack another (or waste an attempt).
      if (recoverability.transcriptPending) return { kind: 'wait' };
      if (attempts < maxAttempts && recoverability.recordingId !== null) {
        return { kind: 'retranscribe', recordingId: recoverability.recordingId };
      }
      return { kind: 'escalate', reason: RETRANSCRIBE_EXHAUSTED_REASON };
    case 'unrecoverable':
      return { kind: 'escalate', reason: NO_RECORDING_REASON };
  }
}

/** One overdue meeting the sweep operates on. */
interface StaleMeeting {
  readonly id: string;
  readonly title: string | null;
  readonly meeting_lead_user_id: string | null;
  readonly attendee_user_ids: string[];
  readonly client_id: string | null;
  readonly bot_job_id: string | null;
  readonly retranscribe_attempts: number;
}

/** Insert a `needs_attention` notification for the lead (or attendees as fallback). */
async function notifyLead(db: ServerClient, meeting: StaleMeeting, reason: string): Promise<void> {
  const recipients =
    meeting.meeting_lead_user_id !== null ? [meeting.meeting_lead_user_id] : meeting.attendee_user_ids;
  if (recipients.length === 0) return;

  const label = meeting.title ?? 'a meeting';
  const link = meeting.client_id !== null ? `/clients/${meeting.client_id}` : '/pipeline';
  const rows: NotificationInsert[] = recipients.map((userId) => ({
    user_id: userId,
    type: 'needs_attention',
    title: `Notes couldn’t be created for ${label}`,
    body: reason,
    link,
  }));
  const { error } = await db.from('notifications').insert(rows);
  if (error !== null) throw new Error(`watchdog: insert notifications: ${error.message}`);
}

/** Flag a meeting `needs_attention`, notify the lead, and email the Admins (escalation). */
async function escalate(
  db: ServerClient,
  meeting: StaleMeeting,
  reason: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const patched = await db
    .from('meetings')
    .update({ pipeline_status: 'needs_attention' })
    .eq('id', meeting.id);
  if (patched.error !== null) throw new Error(`watchdog: flag meeting ${meeting.id}: ${patched.error.message}`);
  await notifyLead(db, meeting, reason);
  const label = meeting.title ?? 'a meeting';
  await emailAdminsForAlert(
    {
      type: 'needs_attention',
      title: `Notes couldn’t be created for ${label}`,
      body: reason,
      link: meeting.client_id !== null ? `/clients/${meeting.client_id}` : '/pipeline',
    },
    { logger: log, db },
  );
  log.warn({ meetingId: meeting.id, reason }, 'watchdog: escalated to needs_attention');
}

/**
 * Build the watchdog processor. `enqueueGenerate` is injected (wired in index.ts to
 * the generate queue) so the self-heal can re-queue a `regenerate` meeting without
 * the worker importing the web queue producer.
 */
export function createWatchdogProcessor(
  logger: FastifyBaseLogger,
  enqueueGenerate: (payload: GenerationJobPayload) => Promise<void>,
): Processor<WatchdogJobPayload, WatchdogResult> {
  return async (job: Job<WatchdogJobPayload>): Promise<WatchdogResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const cutoff = new Date(Date.now() - TRANSCRIPT_TIMEOUT_MINUTES * 60_000);

    const { data, error } = await db
      .from('meetings')
      .select(
        'id, title, meeting_lead_user_id, attendee_user_ids, client_id, bot_job_id, retranscribe_attempts, pipeline_started_at, date_time',
      )
      .eq('bot_dispatched', true)
      .eq('transcript_received', false)
      .in('pipeline_status', WAITING_STATES);
    if (error !== null) throw new Error(`watchdog: scan meetings: ${error.message}`);

    const candidates = data ?? [];
    // A meeting is overdue if its reference time (pipeline start, else scheduled
    // start) is older than the SLA cutoff.
    const stale = candidates.filter((m) => new Date(m.pipeline_started_at ?? m.date_time) < cutoff);

    // Recall key resolved once. Without it we can't classify — fall back to the
    // legacy behavior (flag every overdue meeting) so nothing stays invisible.
    const apiKey = await getCredential('recall');
    const region = process.env.RECALL_REGION;

    let flagged = 0;
    let regenerated = 0;
    let retranscribed = 0;

    for (const meeting of stale) {
      try {
        if (apiKey === null || apiKey === '' || meeting.bot_job_id === null || meeting.bot_job_id === '') {
          await escalate(db, meeting, NO_TRANSCRIPT_REASON, log);
          flagged += 1;
          continue;
        }

        const recoverability = await classifyRecallRecoverability(meeting.bot_job_id, { apiKey, region });
        const action = decideWatchdogAction(recoverability, meeting.retranscribe_attempts, MAX_RETRANSCRIBE_ATTEMPTS);

        switch (action.kind) {
          case 'wait':
            // Transcript already in flight — leave it for the next sweep.
            break;
          case 'regenerate':
            await enqueueGenerate({ meetingId: meeting.id, botJobId: meeting.bot_job_id });
            await db
              .from('meetings')
              .update({ pipeline_status: 'processing', pipeline_started_at: new Date().toISOString() })
              .eq('id', meeting.id);
            regenerated += 1;
            log.info({ meetingId: meeting.id }, 'watchdog: transcript ready — re-queued generation');
            break;
          case 'retranscribe':
            await createRecallAsyncTranscript(action.recordingId, { apiKey, region });
            await db
              .from('meetings')
              .update({
                retranscribe_attempts: meeting.retranscribe_attempts + 1,
                pipeline_status: 'awaiting_transcript',
              })
              .eq('id', meeting.id);
            retranscribed += 1;
            log.info(
              { meetingId: meeting.id, attempt: meeting.retranscribe_attempts + 1, detail: recoverability.detail },
              'watchdog: recording found, transcript missing/failed — requested async transcription',
            );
            break;
          case 'escalate':
            await escalate(db, meeting, action.reason, log);
            flagged += 1;
            break;
        }
      } catch (err) {
        // A transient Recall/DB error must not fail the whole sweep — the meeting
        // stays overdue (still visible in the fleet view) and is retried next sweep.
        log.error({ meetingId: meeting.id, err: err instanceof Error ? err.message : String(err) }, 'watchdog: self-heal error — will retry next sweep');
      }
    }

    if (flagged > 0 || regenerated > 0 || retranscribed > 0 || candidates.length > 0) {
      log.info({ scanned: candidates.length, flagged, regenerated, retranscribed }, 'watchdog sweep');
    }
    return { scanned: candidates.length, flagged, regenerated, retranscribed };
  };
}
