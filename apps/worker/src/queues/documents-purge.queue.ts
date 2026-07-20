/**
 * Documents-purge queue — a nightly repeatable sweep that permanently destroys
 * recycle-bin items past the retention window. No external producer: the worker owns
 * the schedule, mirroring the contact-suggestions/relationship-health sweeps.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  DOCUMENTS_PURGE_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type DocumentsPurgeJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

export function createDocumentsPurgeQueue(connection: Redis): Queue<DocumentsPurgeJobPayload> {
  return createQueue<DocumentsPurgeJobPayload>(QUEUE_NAMES.documentsPurge, connection);
}

/**
 * Upsert the nightly purge schedule. Idempotent (stable scheduler id), so restarting
 * the worker REFRESHES the schedule rather than stacking duplicate repeatables.
 */
export async function scheduleDocumentsPurge(
  queue: Queue<DocumentsPurgeJobPayload>,
): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.documentsPurge,
    { every: DOCUMENTS_PURGE_INTERVAL_MS },
    { name: JOB_NAMES.documentsPurgeSweep, data: { source: 'scheduler' } },
  );
}
