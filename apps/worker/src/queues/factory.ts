/**
 * Queue/Worker factories — the reusable pattern P4/P5 extend.
 *
 * Both bind to the single shared ioredis connection and apply sane defaults
 * (retry with exponential backoff, bounded retention) so every queue behaves
 * consistently. Later phases call these with their own queue names + processors.
 */
import { Queue, Worker } from 'bullmq';
import type { Processor, WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';

/**
 * Default per-job options for every queue. Retry with exponential backoff per
 * docs/06 §8 — transient provider/Graph/Recall failures should self-heal before
 * a run is marked `needs_attention`. Completed jobs are trimmed to keep Redis
 * bounded; failed jobs are retained longer for inspection in Bull Board.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

/** Build a `Queue` bound to the shared connection with the default job options. */
export function createQueue<TData = unknown>(name: string, connection: Redis): Queue<TData> {
  return new Queue<TData>(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

/** Build a `Worker` for `name` running `processor`, bound to the shared connection. */
export function createWorker<TData = unknown>(
  name: string,
  processor: Processor<TData>,
  connection: Redis,
  options?: Omit<WorkerOptions, 'connection'>,
): Worker<TData> {
  return new Worker<TData>(name, processor, {
    connection,
    ...options,
  });
}
