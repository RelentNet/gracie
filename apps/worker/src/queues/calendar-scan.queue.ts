/**
 * Calendar-scan queue (P4, docs/07 §6) — a repeatable sweep that reads the group
 * members' Outlook calendars and upserts `meetings`. No external producer: the
 * worker owns the schedule, mirroring the heartbeat/watchdog queues.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  CALENDAR_SCAN_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type CalendarScanJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the calendar-scan queue on the shared connection. */
export function createCalendarScanQueue(connection: Redis): Queue<CalendarScanJobPayload> {
  return createQueue<CalendarScanJobPayload>(QUEUE_NAMES.calendarScan, connection);
}

/**
 * Upsert the repeatable calendar-scan schedule. Idempotent: keyed by a stable
 * scheduler id, so restarting the worker REFRESHES the schedule rather than
 * stacking duplicate repeatables. The processor no-ops outside business hours.
 */
export async function scheduleCalendarScan(queue: Queue<CalendarScanJobPayload>): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.calendarScan,
    { every: CALENDAR_SCAN_INTERVAL_MS },
    { name: JOB_NAMES.calendarScan, data: { source: 'scheduler' } },
  );
}
