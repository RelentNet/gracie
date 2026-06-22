/**
 * Watchdog queue (P5b, docs/06 §8) — a repeatable sweep that flags meetings stuck
 * awaiting a transcript past the SLA (`TRANSCRIPT_TIMEOUT_MINUTES`). No external
 * producer: the worker owns the schedule, mirroring the heartbeat queue.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  TRANSCRIPT_WATCHDOG_INTERVAL_MS,
  type WatchdogJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the watchdog queue on the shared connection. */
export function createWatchdogQueue(connection: Redis): Queue<WatchdogJobPayload> {
  return createQueue<WatchdogJobPayload>(QUEUE_NAMES.watchdog, connection);
}

/**
 * Upsert the repeatable transcript-watchdog schedule. Idempotent: keyed by a
 * stable scheduler id, so restarting the worker REFRESHES the schedule rather
 * than stacking duplicate repeatables.
 */
export async function scheduleTranscriptWatchdog(
  queue: Queue<WatchdogJobPayload>,
): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.transcriptWatchdog,
    { every: TRANSCRIPT_WATCHDOG_INTERVAL_MS },
    {
      name: JOB_NAMES.watchdog,
      data: { source: 'scheduler' },
    },
  );
}
