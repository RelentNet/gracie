/**
 * Contact-suggestions queue (phase `CO`) — a nightly repeatable sweep that scans
 * meeting external attendees and upserts pending `contact_suggestions`. No external
 * producer: the worker owns the schedule, mirroring the calendar-scan/watchdog queues.
 * The same job may also be enqueued after a calendar scan (a backstop, not the sole
 * trigger).
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  CONTACT_SUGGESTIONS_INTERVAL_MS,
  JOB_NAMES,
  JOB_SCHEDULER_IDS,
  QUEUE_NAMES,
  type ContactSuggestionsJobPayload,
} from '@gracie/shared';

import { createQueue } from './factory.js';

/** Create the contact-suggestions queue on the shared connection. */
export function createContactSuggestionsQueue(
  connection: Redis,
): Queue<ContactSuggestionsJobPayload> {
  return createQueue<ContactSuggestionsJobPayload>(QUEUE_NAMES.contactSuggestions, connection);
}

/**
 * Upsert the nightly contact-suggestions schedule. Idempotent (keyed by a stable
 * scheduler id), so restarting the worker REFRESHES the schedule rather than stacking
 * duplicate repeatables.
 */
export async function scheduleContactSuggestions(
  queue: Queue<ContactSuggestionsJobPayload>,
): Promise<void> {
  await queue.upsertJobScheduler(
    JOB_SCHEDULER_IDS.contactSuggestions,
    { every: CONTACT_SUGGESTIONS_INTERVAL_MS },
    { name: JOB_NAMES.contactSuggestionsSweep, data: { source: 'scheduler' } },
  );
}
