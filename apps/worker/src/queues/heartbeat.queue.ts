/**
 * Heartbeat queue — the sample queue that proves the enqueue → process loop with
 * no external dependencies. A single repeatable job ticks ~every 30s.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  HEARTBEAT_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type HeartbeatJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the heartbeat queue on the shared connection. */
export function createHeartbeatQueue(connection: Redis): Queue<HeartbeatJobPayload> {
  return createQueue<HeartbeatJobPayload>(QUEUE_NAMES.heartbeat, connection);
}

/**
 * Upsert the repeatable heartbeat schedule. Idempotent: keyed by a stable
 * scheduler id, so restarting the worker REFRESHES the schedule rather than
 * stacking duplicate repeatables.
 */
export async function scheduleHeartbeat(queue: Queue<HeartbeatJobPayload>): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.heartbeat,
    { every: HEARTBEAT_INTERVAL_MS },
    {
      name: JOB_NAMES.heartbeat,
      data: { source: 'scheduler' },
    },
  );
}
