/**
 * Import-Outlook-contacts queue — admin-triggered pull of one mailbox's Outlook
 * contacts into `contacts`. Ad-hoc (no repeatable schedule): the web
 * `/api/contacts/import` route is the producer, this worker the consumer.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, type OutlookContactsImportJobPayload } from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the import-Outlook-contacts queue on the shared connection. */
export function createImportOutlookContactsQueue(
  connection: Redis,
): Queue<OutlookContactsImportJobPayload> {
  return createQueue<OutlookContactsImportJobPayload>(QUEUE_NAMES.outlookContactsImport, connection);
}
