/**
 * Pipeline queue — PLACEHOLDER (Phase 1A).
 *
 * The meeting/upload generation pipeline runs here in Phase 1B (BullMQ + Redis,
 * D2). CRITICAL Phase 1A constraint: importing this module must NOT open a Redis
 * connection. A BullMQ `Queue` connects eagerly on construction, so we DO NOT
 * construct it at module load. Instead we expose a lazy factory that is only
 * invoked when `REDIS_URL` is configured (see index.ts). This keeps the worker
 * startable with no Redis present.
 *
 * Phase 1B TODO:
 *   - construct the Queue against REDIS_URL
 *   - register processors (pipeline, ingest, calendar-scan, etc. — docs/03 §4)
 *   - add repeatable jobs (calendar scan, daily sync, watchdog)
 */
import type { Queue } from 'bullmq';

export const PIPELINE_QUEUE_NAME = 'pipeline' as const;

/**
 * Lazily create the pipeline queue. Only call this once a Redis connection
 * string is known — never at import time.
 *
 * Phase 1A: throws to make accidental early use loud. The bootstrap guards
 * against calling it when REDIS_URL is absent.
 */
export function createPipelineQueue(_redisUrl: string): Queue {
  throw new Error(
    'Pipeline queue is not implemented in Phase 1A. Wire BullMQ + Redis in Phase 1B.',
  );
}
