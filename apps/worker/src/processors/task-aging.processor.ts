/**
 * Task-aging sweep (tasks lifecycle core).
 *
 * GA judges tasks on how reliably they CLEAR. A standard-priority task nobody has
 * touched in two weeks (GA's cadence) has gone stale, so the sweep archives it —
 * getting it out of the active list without losing it. This is what keeps the board
 * short instead of accumulating a graveyard of forgotten items.
 *
 *  - Archive is a STATUS change, never a delete: everything stays recoverable via
 *    "Show archived" → Restore (and a repeat mention reactivates it as high).
 *  - HIGH tasks are never aged out — they persist until done.
 *  - "Activity" is `updated_at`: completing, editing, escalating, or reactivating a
 *    task all bump it. ponytail: no separate last_activity column — updated_at is the
 *    activity signal; add one only if note-adds need to reset the clock too.
 *  - Bounded + idempotent: one filtered UPDATE per sweep; a task already archived or
 *    already touched inside the window is simply not selected.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { TaskAgingJobPayload } from '@gracie/shared';

import { agingCutoffIso, STANDARD_TASK_TTL_DAYS } from '../lib/task-lifecycle.js';

/** Outcome of one sweep (visible in Bull Board). */
export interface TaskAgingResult {
  readonly ttlDays: number;
  readonly archived: number;
}

export function createTaskAgingProcessor(
  log: FastifyBaseLogger,
): Processor<TaskAgingJobPayload, TaskAgingResult> {
  return async (job: Job<TaskAgingJobPayload>): Promise<TaskAgingResult> => {
    const db = getServerClient();
    const cutoff = agingCutoffIso(new Date());

    const { data, error } = await db
      .from('tasks')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('archived', false)
      .eq('priority_flag', false)
      .neq('status', 'complete')
      .lt('updated_at', cutoff)
      .select('id');
    if (error !== null) throw new Error(`task-aging: archive stale tasks: ${error.message}`);

    const archived = data?.length ?? 0;
    log.info(
      { ttlDays: STANDARD_TASK_TTL_DAYS, cutoff, archived, source: job.data.source },
      'task-aging sweep',
    );
    return { ttlDays: STANDARD_TASK_TTL_DAYS, archived };
  };
}
