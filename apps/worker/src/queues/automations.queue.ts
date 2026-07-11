/**
 * Automations queue (P8) — a repeatable ~5-min DUE-SWEEP that runs every enabled +
 * active automation whose `next_run_at` has arrived, plus on-demand RUN-NOW jobs the
 * web app enqueues (GUI "Run now" + an immediate `once` confirm). The worker owns the
 * repeatable schedule, mirroring daily-sync / relationship-health. The processor
 * distinguishes the two shapes by payload (`automationId` set → single run).
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  AUTOMATIONS_SWEEP_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type AutomationJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the automations queue on the shared connection. */
export function createAutomationsQueue(connection: Redis): Queue<AutomationJobPayload> {
  return createQueue<AutomationJobPayload>(QUEUE_NAMES.automations, connection);
}

/**
 * Upsert the repeatable due-sweep schedule. Idempotent: keyed by a stable scheduler
 * id, so restarting the worker REFRESHES the schedule rather than stacking duplicate
 * repeatables. The processor selects only rows whose `next_run_at <= now`.
 */
export async function scheduleAutomations(queue: Queue<AutomationJobPayload>): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.automations,
    { every: AUTOMATIONS_SWEEP_INTERVAL_MS },
    { name: JOB_NAMES.automationsSweep, data: { source: 'scheduler' } },
  );
}
