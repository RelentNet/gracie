/**
 * Daily-sync queue (P7, docs/plan p7 §6) — a repeatable sweep that builds the 6 AM
 * ET morning digest + that day's pre-meeting briefs and emails all active staff.
 * No external producer: the worker owns the schedule, mirroring calendar-scan.
 * The processor no-ops outside the configured send hour (ET) and is idempotent per
 * `sync_date`; a `source='manual'` run bypasses the gate.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  DAILY_SYNC_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type DailySyncJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the daily-sync queue on the shared connection. */
export function createDailySyncQueue(connection: Redis): Queue<DailySyncJobPayload> {
  return createQueue<DailySyncJobPayload>(QUEUE_NAMES.dailySync, connection);
}

/**
 * Upsert the repeatable daily-sync schedule. Idempotent: keyed by a stable
 * scheduler id, so restarting the worker REFRESHES the schedule rather than
 * stacking duplicate repeatables. The processor gates on the ET send hour.
 */
export async function scheduleDailySync(queue: Queue<DailySyncJobPayload>): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.dailySync,
    { every: DAILY_SYNC_INTERVAL_MS },
    { name: JOB_NAMES.dailySync, data: { source: 'scheduler' } },
  );
}
