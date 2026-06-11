/**
 * Ingest queue (P5a) — manual-upload pipeline: extract → chunk → embed → pgvector.
 * The web `/api/upload` route is the producer; this worker is the consumer.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, type IngestJobPayload } from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the ingest queue on the shared connection. */
export function createIngestQueue(connection: Redis): Queue<IngestJobPayload> {
  return createQueue<IngestJobPayload>(QUEUE_NAMES.ingest, connection);
}
