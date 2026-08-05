/**
 * Resume-recording queue (voice commands) — consumes the DELAYED resume job the web
 * transcript webhook enqueues after a "stop listening for N minutes" command. Not a
 * repeatable schedule: one job per pause, with a BullMQ `delay` set by the producer
 * (`apps/web/lib/queue.ts`). This module only builds the queue; the processor resumes
 * the bot and treats an already-resumed/ended bot as a harmless no-op.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, type ResumeRecordingJobPayload } from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the resume-recording queue on the shared connection. */
export function createResumeRecordingQueue(connection: Redis): Queue<ResumeRecordingJobPayload> {
  return createQueue<ResumeRecordingJobPayload>(QUEUE_NAMES.resumeRecording, connection);
}
