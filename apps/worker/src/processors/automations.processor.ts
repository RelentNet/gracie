/**
 * Automations engine processor (P8 §4). Two shapes share the queue, mirroring
 * relationship-health:
 *
 *   • DUE-SWEEP (no `automationId`): `select * from automations where enabled and
 *     status='active' and next_run_at <= now`; run each, write an `automation_runs`
 *     audit row, and advance `next_run_at` from the schedule (a `once` automation
 *     runs then flips to `cancelled`). One bad automation never aborts the sweep.
 *
 *   • RUN-NOW (`automationId` set, `source:'manual'`): run exactly one automation
 *     immediately (GUI "Run now" / an immediate `once` confirm), regardless of its
 *     `next_run_at`. A recurring automation's schedule is left untouched (this is an
 *     extra on-demand run); a `once` automation is still cancelled after it fires.
 *
 * Every run — success, failure, or skip — is logged to `automation_runs`, and any
 * externals emailed under the §2b exception are recorded in `external_recipients`.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import { nextRunAfter, parseSchedule, type AutomationJobPayload } from '@gracie/shared';

import { runAutomation, type ExecutionOutcome } from '../lib/automation-executors.js';

type AutomationRow = Database['public']['Tables']['automations']['Row'];
type AutomationUpdate = Database['public']['Tables']['automations']['Update'];

/** Max automations run per sweep — bounds a single tick's work. */
const SWEEP_LIMIT = 50;

/** Outcome of one processor invocation (visible in Bull Board). */
export interface AutomationsResult {
  /** How many automations were run this invocation. */
  readonly ran: number;
  /** How many of those failed. */
  readonly failed: number;
  /** How many were skipped (e.g. external send disabled, client gone). */
  readonly skipped: number;
}

/** Append the audit row for a run. */
async function recordRun(
  db: ServerClient,
  automationId: string,
  startedAtIso: string,
  outcome: ExecutionOutcome,
): Promise<void> {
  const { error } = await db.from('automation_runs').insert({
    automation_id: automationId,
    status: outcome.status,
    started_at: startedAtIso,
    finished_at: new Date().toISOString(),
    detail: outcome.detail,
    external_recipients: outcome.externalRecipients,
  });
  if (error !== null) throw new Error(`automations: record run: ${error.message}`);
}

/**
 * Run one automation and persist both the audit row and the automation's own
 * bookkeeping (last-run mirror + next_run_at). `advanceSchedule` is true only for
 * the sweep — a manual run never reschedules a recurring automation (but a `once`
 * automation is always cancelled once it has fired).
 */
async function runOne(
  db: ServerClient,
  log: FastifyBaseLogger,
  now: Date,
  automation: AutomationRow,
  advanceSchedule: boolean,
): Promise<ExecutionOutcome> {
  const startedAtIso = now.toISOString();
  let outcome: ExecutionOutcome;
  try {
    outcome = await runAutomation({ db, log, now, automation });
  } catch (err) {
    // An unexpected executor error is recorded as a failed run (not rethrown) so one
    // automation can't fail the whole sweep; BullMQ still sees the job succeed.
    outcome = {
      status: 'failed',
      detail: `executor error: ${err instanceof Error ? err.message : String(err)}`,
      externalRecipients: [],
    };
  }

  await recordRun(db, automation.id, startedAtIso, outcome);

  const parsed = parseSchedule(automation.schedule);
  const schedule = 'schedule' in parsed ? parsed.schedule : null;

  const nowIso = new Date().toISOString();
  const patch: AutomationUpdate = {
    last_run_at: nowIso,
    last_run_status: outcome.status,
    updated_at: nowIso,
  };
  if (schedule?.kind === 'once') {
    // A one-off is finished once it has fired, whichever path ran it.
    patch.status = 'cancelled';
    patch.enabled = false;
    patch.next_run_at = null;
  } else if (advanceSchedule) {
    if (schedule === null) {
      // An unparseable schedule can't be advanced — pause it so it stops looping.
      patch.status = 'paused';
      patch.enabled = false;
      patch.next_run_at = null;
      log.warn({ automationId: automation.id }, 'automations: invalid schedule — paused');
    } else {
      patch.next_run_at = nextRunAfter(schedule, now);
    }
  }

  const { error } = await db.from('automations').update(patch).eq('id', automation.id);
  if (error !== null) throw new Error(`automations: update after run: ${error.message}`);

  log.info(
    { automationId: automation.id, type: automation.type, status: outcome.status, detail: outcome.detail },
    'automations: run complete',
  );
  return outcome;
}

/** Build the automations processor, logging through the worker's Fastify logger. */
export function createAutomationsProcessor(
  logger: FastifyBaseLogger,
): Processor<AutomationJobPayload, AutomationsResult> {
  return async (job: Job<AutomationJobPayload>): Promise<AutomationsResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const now = new Date();

    // --- RUN-NOW: a single automation, immediately. ---
    if (job.data.automationId !== undefined) {
      const { data, error } = await db
        .from('automations')
        .select('*')
        .eq('id', job.data.automationId)
        .maybeSingle();
      if (error !== null) throw new Error(`automations: load one: ${error.message}`);
      if (data === null || data.status === 'cancelled') {
        log.info({ automationId: job.data.automationId }, 'automations: run-now target missing/cancelled — skipping');
        return { ran: 0, failed: 0, skipped: 1 };
      }
      const outcome = await runOne(db, log, now, data, false);
      return {
        ran: 1,
        failed: outcome.status === 'failed' ? 1 : 0,
        skipped: outcome.status === 'skipped' ? 1 : 0,
      };
    }

    // --- DUE-SWEEP: every enabled+active automation whose next_run_at has arrived. ---
    const { data, error } = await db
      .from('automations')
      .select('*')
      .eq('enabled', true)
      .eq('status', 'active')
      .lte('next_run_at', now.toISOString())
      .order('next_run_at', { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error !== null) throw new Error(`automations: due sweep: ${error.message}`);

    const due = data ?? [];
    let ran = 0;
    let failed = 0;
    let skipped = 0;
    for (const automation of due) {
      try {
        const outcome = await runOne(db, log, now, automation, true);
        ran += 1;
        if (outcome.status === 'failed') failed += 1;
        if (outcome.status === 'skipped') skipped += 1;
      } catch (err) {
        // Bookkeeping failure for one automation — log and continue the sweep.
        log.error({ automationId: automation.id, err }, 'automations: run failed (non-fatal)');
        failed += 1;
      }
    }
    if (due.length > 0) log.info({ ran, failed, skipped, due: due.length }, 'automations sweep complete');
    return { ran, failed, skipped };
  };
}
