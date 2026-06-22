/**
 * Producer-side BullMQ access for API routes (P5a). Server-only — the web app
 * enqueues jobs the `apps/worker` service consumes. Keeps `@gracie/shared`
 * client-safe (queue NAMES live there; the `Queue`/ioredis objects live here).
 *
 * Lazily builds a single shared ioredis connection + ingest `Queue` per server
 * process. Job options mirror the worker's `DEFAULT_JOB_OPTIONS` (retry with
 * exponential backoff, bounded retention) so producer and consumer agree.
 */
import 'server-only';

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  JOB_NAMES,
  QUEUE_NAMES,
  type GenerationJobPayload,
  type IngestJobPayload,
} from '@gracie/shared';

/** Mirrors apps/worker queues/factory.ts DEFAULT_JOB_OPTIONS. */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

let connection: Redis | undefined;
let ingestQueue: Queue<IngestJobPayload> | undefined;
let generateQueue: Queue<GenerationJobPayload> | undefined;

function getConnection(): Redis {
  if (connection !== undefined) return connection;
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') {
    throw new Error('REDIS_URL is not set — required to enqueue ingest jobs.');
  }
  // maxRetriesPerRequest: null is required by BullMQ's blocking commands.
  connection = new Redis(url, { maxRetriesPerRequest: null });
  return connection;
}

function getIngestQueue(): Queue<IngestJobPayload> {
  if (ingestQueue !== undefined) return ingestQueue;
  ingestQueue = new Queue<IngestJobPayload>(QUEUE_NAMES.ingest, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return ingestQueue;
}

/** Enqueue one manual-upload ingest job; returns the BullMQ job id. */
export async function enqueueIngest(payload: IngestJobPayload): Promise<string> {
  const job = await getIngestQueue().add(JOB_NAMES.ingest, payload);
  return job.id ?? '';
}

function getGenerateQueue(): Queue<GenerationJobPayload> {
  if (generateQueue !== undefined) return generateQueue;
  generateQueue = new Queue<GenerationJobPayload>(QUEUE_NAMES.generate, {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return generateQueue;
}

/** Enqueue one meeting-generation job (Recall webhook → pipeline); returns the job id. */
export async function enqueueGenerate(payload: GenerationJobPayload): Promise<string> {
  const job = await getGenerateQueue().add(JOB_NAMES.generate, payload);
  return job.id ?? '';
}
