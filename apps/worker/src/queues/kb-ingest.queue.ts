/**
 * Knowledge Base ingest queue (P6) — global reference-doc pipeline:
 * extract → chunk → embed → pgvector. The web `/api/knowledge-base` route is the
 * producer; this worker is the consumer. Mirrors the manual-upload ingest queue,
 * but KB embeddings are firm-wide (`client_id=null`), not client-scoped.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, type KbIngestJobPayload } from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the KB-ingest queue on the shared connection. */
export function createKbIngestQueue(connection: Redis): Queue<KbIngestJobPayload> {
  return createQueue<KbIngestJobPayload>(QUEUE_NAMES.kbIngest, connection);
}
