/**
 * Task-aging queue (tasks lifecycle core) — a nightly repeatable sweep that archives
 * standard-priority tasks with no activity past the aging window. No external producer:
 * the worker owns the schedule, mirroring the documents-purge / contact-suggestions /
 * relationship-health sweeps.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  TASK_AGING_INTERVAL_MS,
  type TaskAgingJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

export function createTaskAgingQueue(connection: Redis): Queue<TaskAgingJobPayload> {
  return createQueue<TaskAgingJobPayload>(QUEUE_NAMES.taskAging, connection);
}

/**
 * Upsert the nightly aging schedule. Idempotent (stable scheduler id), so restarting
 * the worker REFRESHES the schedule rather than stacking duplicate repeatables.
 */
export async function scheduleTaskAging(queue: Queue<TaskAgingJobPayload>): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.taskAging,
    { every: TASK_AGING_INTERVAL_MS },
    { name: JOB_NAMES.taskAgingSweep, data: { source: 'scheduler' } },
  );
}
