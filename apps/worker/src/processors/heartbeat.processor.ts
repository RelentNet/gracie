/**
 * Heartbeat processor — logs one line per tick. This is the proof-of-life for the
 * Redis → BullMQ → Worker loop (Phase 1B foundation); it has no external
 * dependencies. Real processors (pipeline, ingest, calendar-scan, ...) arrive in
 * P4/P5 against this same factory pattern.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { HeartbeatJobPayload } from '@gracie/shared';

/** Result of a heartbeat tick. */
export interface HeartbeatResult {
  readonly ok: true;
}

/** Build the heartbeat processor, logging through the worker's Fastify logger. */
export function createHeartbeatProcessor(
  logger: FastifyBaseLogger,
): Processor<HeartbeatJobPayload, HeartbeatResult> {
  return async (job: Job<HeartbeatJobPayload>): Promise<HeartbeatResult> => {
    logger.info(
      { jobId: job.id, source: job.data.source, attempt: job.attemptsMade + 1 },
      'heartbeat tick',
    );
    return { ok: true };
  };
}
