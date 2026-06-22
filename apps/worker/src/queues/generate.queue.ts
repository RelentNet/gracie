/**
 * Generate queue (P5b) — meeting-generation pipeline: transcript → embed → 6 docs
 * → tasks → master record → notify (docs/06 §4). The web `/api/webhooks/recall`
 * route is the producer; this worker is the consumer.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, type GenerationJobPayload } from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the generate queue on the shared connection. */
export function createGenerateQueue(connection: Redis): Queue<GenerationJobPayload> {
  return createQueue<GenerationJobPayload>(QUEUE_NAMES.generate, connection);
}
