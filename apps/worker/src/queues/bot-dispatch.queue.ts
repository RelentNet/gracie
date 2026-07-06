/**
 * Bot-dispatch queue (P4, docs/07 §1) — a tight repeatable sweep that dispatches
 * one Recall bot per due meeting. No external producer: the worker owns the
 * schedule, mirroring the heartbeat/watchdog queues.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  BOT_DISPATCH_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type BotDispatchJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the bot-dispatch queue on the shared connection. */
export function createBotDispatchQueue(connection: Redis): Queue<BotDispatchJobPayload> {
  return createQueue<BotDispatchJobPayload>(QUEUE_NAMES.botDispatch, connection);
}

/**
 * Upsert the repeatable bot-dispatch schedule. Idempotent: keyed by a stable
 * scheduler id, so restarting the worker REFRESHES the schedule rather than
 * stacking duplicate repeatables.
 */
export async function scheduleBotDispatch(queue: Queue<BotDispatchJobPayload>): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.botDispatch,
    { every: BOT_DISPATCH_INTERVAL_MS },
    { name: JOB_NAMES.botDispatch, data: { source: 'scheduler' } },
  );
}
