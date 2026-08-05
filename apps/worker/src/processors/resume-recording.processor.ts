/**
 * Resume-recording processor (voice commands). Fires when a delayed resume job
 * (enqueued by the transcript webhook after "stop listening for N minutes") comes
 * due. Resumes the paused bot's recording.
 *
 * BEST-EFFORT BY DESIGN. By the time this fires the bot may have already resumed,
 * been asked to leave, or the meeting may have ended — in which case Recall rejects
 * the resume. That is a harmless no-op, not a failure, so a rejected resume is logged
 * and the job COMPLETES (never retried): retrying can't help, and the recording
 * stays safely paused. Only a missing bot id / missing key is treated as a config
 * error worth surfacing.
 *
 * ponytail: swallow-all resume errors (no retry). A transient Recall/network blip at
 * the exact resume instant loses the tail of the recording — acceptable for a rare,
 * opt-in nicety; upgrade to retry-on-5xx if it ever bites.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getCredential } from '@gracie/db';
import { resumeRecallBot } from '@gracie/shared/recall';
import type { ResumeRecordingJobPayload } from '@gracie/shared';

export interface ResumeRecordingResult {
  readonly resumed: boolean;
  readonly reason?: string;
}

export function createResumeRecordingProcessor(
  log: FastifyBaseLogger,
): Processor<ResumeRecordingJobPayload, ResumeRecordingResult> {
  return async (job: Job<ResumeRecordingJobPayload>): Promise<ResumeRecordingResult> => {
    const { botJobId, meetingId } = job.data;
    if (typeof botJobId !== 'string' || botJobId === '') {
      log.error({ meetingId }, 'resume-recording: missing botJobId — nothing to resume');
      return { resumed: false, reason: 'missing_bot' };
    }

    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      log.error({ meetingId, botJobId }, 'resume-recording: no Recall API key configured');
      return { resumed: false, reason: 'no_key' };
    }

    try {
      await resumeRecallBot(botJobId, { apiKey, region: process.env.RECALL_REGION });
      log.info({ meetingId, botJobId }, 'resume-recording: recording resumed');
      return { resumed: true };
    } catch (err) {
      // Already resumed / bot left / meeting ended → harmless. Log and complete.
      log.warn({ meetingId, botJobId, err }, 'resume-recording: resume was a no-op (bot likely already resumed or gone)');
      return { resumed: false, reason: 'noop' };
    }
  };
}
