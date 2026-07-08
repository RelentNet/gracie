/**
 * Relationship-health queue (P2.1) — a nightly repeatable sweep that recomputes
 * every active client's health score + trend, plus event-triggered single-client
 * jobs enqueued by the web app (client edit, task, note change). The worker owns the
 * nightly schedule, mirroring the calendar-scan/watchdog queues.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  RELATIONSHIP_HEALTH_INTERVAL_MS,
  type RelationshipHealthJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the relationship-health queue on the shared connection. */
export function createRelationshipHealthQueue(connection: Redis): Queue<RelationshipHealthJobPayload> {
  return createQueue<RelationshipHealthJobPayload>(QUEUE_NAMES.relationshipHealth, connection);
}

/**
 * Upsert the nightly all-clients recompute schedule. Idempotent (keyed by a stable
 * scheduler id). A sweep job carries no `clientId`, so the processor recomputes every
 * active client; single-client event jobs are enqueued separately by the web app.
 */
export async function scheduleRelationshipHealth(
  queue: Queue<RelationshipHealthJobPayload>,
): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.relationshipHealth,
    { every: RELATIONSHIP_HEALTH_INTERVAL_MS },
    { name: JOB_NAMES.relationshipHealthSweep, data: { source: 'scheduler' } },
  );
}
