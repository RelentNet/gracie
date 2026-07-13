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
import type { Database, Json, ServerClient } from '@gracie/db';
import { isEventSchedule, nextRunAfter, parseSchedule, type AutomationJobPayload } from '@gracie/shared';

import { runAutomation, runMeetingBrief, type ExecutionOutcome } from '../lib/automation-executors.js';

type AutomationRow = Database['public']['Tables']['automations']['Row'];
type AutomationUpdate = Database['public']['Tables']['automations']['Update'];

/** Max automations run per sweep — bounds a single tick's work. */
const SWEEP_LIMIT = 50;

/** Max event automations processed per sweep, and meetings fired per event automation. */
const EVENT_SWEEP_LIMIT = 50;
const EVENT_MEETINGS_LIMIT = 50;

/**
 * Grace window (minutes) for the event pass: mirrors bot-dispatch — a meeting whose
 * start slipped just past `now` between sweeps still gets its brief. Bounds the
 * lower edge of the [now − grace, now + leadMinutes] window.
 */
const EVENT_GRACE_MINUTES = 5;

/** Columns a meeting_brief needs from a candidate meeting. */
const EVENT_MEETING_COLS =
  'id, title, date_time, client_id, meeting_lead_user_id, attendee_user_ids, external_attendees, is_internal';

/** A candidate meeting row for the event pass (client_id may be null pre-filter). */
interface EventMeetingRow {
  readonly id: string;
  readonly title: string | null;
  readonly date_time: string;
  readonly client_id: string | null;
  readonly meeting_lead_user_id: string | null;
  readonly attendee_user_ids: string[];
  readonly external_attendees: Json;
  readonly is_internal: boolean;
}

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
      // An event automation ("Run now") targets the NEXT upcoming matching meeting.
      if (data.type === 'meeting_brief') {
        return runEventAutomationNow(db, log, now, data);
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

    // --- EVENT PASS: fire before_meeting automations for meetings starting soon. ---
    // Independent of the schedule due-sweep above (event automations have no
    // next_run_at). One bad automation never aborts the pass.
    const event = await runEventPass(db, log, now);
    ran += event.ran;
    failed += event.failed;
    skipped += event.skipped;

    if (due.length > 0 || event.ran > 0 || event.failed > 0 || event.skipped > 0) {
      log.info({ ran, failed, skipped, due: due.length }, 'automations sweep complete');
    }
    return { ran, failed, skipped };
  };
}

// --- event trigger (P8.1 before_meeting) --------------------------------------

/** Existing (automation, meeting) fire-rows among the given candidates — the claim guard. */
async function loadFiredMeetingIds(
  db: ServerClient,
  automationId: string,
  meetingIds: readonly string[],
): Promise<Set<string>> {
  if (meetingIds.length === 0) return new Set();
  const { data, error } = await db
    .from('automation_runs')
    .select('meeting_id')
    .eq('automation_id', automationId)
    .in('meeting_id', [...meetingIds]);
  if (error !== null) throw new Error(`automations: load fired meetings: ${error.message}`);
  return new Set((data ?? []).map((r) => r.meeting_id).filter((id): id is string => id !== null));
}

/** Mirror the latest run's status onto the automation (event triggers have no next_run_at). */
async function mirrorLastRun(db: ServerClient, automationId: string, status: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from('automations')
    .update({ last_run_at: nowIso, last_run_status: status, updated_at: nowIso })
    .eq('id', automationId);
  if (error !== null) throw new Error(`automations: mirror last run: ${error.message}`);
}

/** Map a candidate row to the executor's target shape (client_id guaranteed non-null by query). */
function toBriefTarget(m: EventMeetingRow): Parameters<typeof runMeetingBrief>[1] {
  return {
    id: m.id,
    title: m.title,
    date_time: m.date_time,
    client_id: m.client_id as string,
    meeting_lead_user_id: m.meeting_lead_user_id,
    attendee_user_ids: m.attendee_user_ids,
    external_attendees: m.external_attendees,
  };
}

/**
 * Fire ONE meeting_brief for one meeting with an exactly-once claim. Mirrors
 * bot-dispatch's per-row idempotent claim: the INSERT into `automation_runs` with
 * `meeting_id` set is atomic against the unique partial index — a 23505 means another
 * sweep already fired this (automation, meeting) pair, so we skip. On success/failure
 * the same claim row is filled in with the outcome. Returns the run status, or null
 * when the claim was lost (already fired).
 */
async function fireMeetingBrief(
  db: ServerClient,
  log: FastifyBaseLogger,
  now: Date,
  automation: AutomationRow,
  meeting: EventMeetingRow,
): Promise<ExecutionOutcome['status'] | null> {
  const startedIso = now.toISOString();
  const claim = await db
    .from('automation_runs')
    .insert({
      automation_id: automation.id,
      meeting_id: meeting.id,
      status: 'skipped', // provisional; overwritten with the real outcome below
      started_at: startedIso,
      detail: 'meeting_brief: claimed',
    })
    .select('id')
    .single();
  if (claim.error !== null) {
    if (claim.error.code === '23505') return null; // another sweep already fired this pair
    throw new Error(`automations: event claim: ${claim.error.message}`);
  }

  let outcome: ExecutionOutcome;
  try {
    outcome = await runMeetingBrief({ db, log, automation }, toBriefTarget(meeting));
  } catch (err) {
    outcome = {
      status: 'failed',
      detail: `meeting_brief error: ${err instanceof Error ? err.message : String(err)}`,
      externalRecipients: [],
    };
  }

  const upd = await db
    .from('automation_runs')
    .update({ status: outcome.status, detail: outcome.detail, finished_at: new Date().toISOString() })
    .eq('id', claim.data.id);
  if (upd.error !== null) log.warn({ runId: claim.data.id, err: upd.error.message }, 'automations: event run update failed');

  await mirrorLastRun(db, automation.id, outcome.status);
  log.info(
    { automationId: automation.id, meetingId: meeting.id, status: outcome.status },
    'automations: meeting_brief fired',
  );
  return outcome.status;
}

/**
 * The event pass: for every enabled+active meeting_brief automation, find client
 * meetings whose start is within [now − grace, now + leadMinutes] (respecting the
 * automation's filters) that this automation has not already fired for, and run each.
 */
async function runEventPass(db: ServerClient, log: FastifyBaseLogger, now: Date): Promise<AutomationsResult> {
  const { data, error } = await db
    .from('automations')
    .select('*')
    .eq('enabled', true)
    .eq('status', 'active')
    .eq('type', 'meeting_brief')
    .limit(EVENT_SWEEP_LIMIT);
  if (error !== null) throw new Error(`automations: event pass load: ${error.message}`);

  const automations = data ?? [];
  let ran = 0;
  let failed = 0;
  let skipped = 0;
  const lowerIso = new Date(now.getTime() - EVENT_GRACE_MINUTES * 60_000).toISOString();

  for (const automation of automations) {
    try {
      const parsed = parseSchedule(automation.schedule);
      if (!('schedule' in parsed) || !isEventSchedule(parsed.schedule)) {
        log.warn({ automationId: automation.id }, 'automations: event automation without an event schedule — skipping');
        continue;
      }
      const schedule = parsed.schedule;
      const upperIso = new Date(now.getTime() + schedule.leadMinutes * 60_000).toISOString();

      // Candidate client meetings in the lead window (mirrors daily-sync briefable set).
      let query = db
        .from('meetings')
        .select(EVENT_MEETING_COLS)
        .not('client_id', 'is', null)
        .eq('is_internal', false)
        .gte('date_time', lowerIso)
        .lte('date_time', upperIso)
        .order('date_time', { ascending: true })
        .limit(EVENT_MEETINGS_LIMIT);
      if (schedule.filters.clientId !== undefined) query = query.eq('client_id', schedule.filters.clientId);
      if (schedule.filters.meetingsILead === true) query = query.eq('meeting_lead_user_id', automation.owner_user_id);

      const mres = await query;
      if (mres.error !== null) throw new Error(`automations: event meetings: ${mres.error.message}`);
      const candidates = (mres.data ?? []) as EventMeetingRow[];
      if (candidates.length === 0) continue;

      const alreadyFired = await loadFiredMeetingIds(db, automation.id, candidates.map((m) => m.id));
      for (const meeting of candidates) {
        if (alreadyFired.has(meeting.id)) continue;
        const status = await fireMeetingBrief(db, log, now, automation, meeting);
        if (status === null) continue; // claim lost — counted by the sweep that won it
        ran += 1;
        if (status === 'failed') failed += 1;
        if (status === 'skipped') skipped += 1;
      }
    } catch (err) {
      // One automation's failure never aborts the pass.
      log.error({ automationId: automation.id, err }, 'automations: event automation failed (non-fatal)');
      failed += 1;
    }
  }
  return { ran, failed, skipped };
}

/**
 * "Run now" for an event automation: fire the brief for the NEXT upcoming matching
 * meeting immediately (or record a skipped run when there is none). A manual run is an
 * explicit extra — it does NOT take the meeting-id claim, so it never conflicts with
 * (or suppresses) the automatic fire, exactly like the schedule-based "Run now".
 */
async function runEventAutomationNow(
  db: ServerClient,
  log: FastifyBaseLogger,
  now: Date,
  automation: AutomationRow,
): Promise<AutomationsResult> {
  const startedIso = now.toISOString();
  const parsed = parseSchedule(automation.schedule);
  if (!('schedule' in parsed) || !isEventSchedule(parsed.schedule)) {
    await recordManualRun(db, automation.id, startedIso, {
      status: 'skipped',
      detail: 'run-now: not an event automation',
      externalRecipients: [],
    });
    await mirrorLastRun(db, automation.id, 'skipped');
    return { ran: 0, failed: 0, skipped: 1 };
  }
  const schedule = parsed.schedule;

  let query = db
    .from('meetings')
    .select(EVENT_MEETING_COLS)
    .not('client_id', 'is', null)
    .eq('is_internal', false)
    .gte('date_time', now.toISOString())
    .order('date_time', { ascending: true })
    .limit(1);
  if (schedule.filters.clientId !== undefined) query = query.eq('client_id', schedule.filters.clientId);
  if (schedule.filters.meetingsILead === true) query = query.eq('meeting_lead_user_id', automation.owner_user_id);

  const mres = await query;
  if (mres.error !== null) throw new Error(`automations: run-now event meetings: ${mres.error.message}`);
  const meeting = (mres.data ?? [])[0] as EventMeetingRow | undefined;

  if (meeting === undefined) {
    await recordManualRun(db, automation.id, startedIso, {
      status: 'skipped',
      detail: 'no upcoming matching meeting to brief',
      externalRecipients: [],
    });
    await mirrorLastRun(db, automation.id, 'skipped');
    log.info({ automationId: automation.id }, 'automations: run-now event — no upcoming meeting');
    return { ran: 0, failed: 0, skipped: 1 };
  }

  let outcome: ExecutionOutcome;
  try {
    outcome = await runMeetingBrief({ db, log, automation }, toBriefTarget(meeting));
  } catch (err) {
    outcome = {
      status: 'failed',
      detail: `meeting_brief error: ${err instanceof Error ? err.message : String(err)}`,
      externalRecipients: [],
    };
  }
  await recordManualRun(db, automation.id, startedIso, outcome);
  await mirrorLastRun(db, automation.id, outcome.status);
  return {
    ran: 1,
    failed: outcome.status === 'failed' ? 1 : 0,
    skipped: outcome.status === 'skipped' ? 1 : 0,
  };
}

/** Append an audit row for a manual event run (no meeting_id → never claim-constrained). */
async function recordManualRun(
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
  if (error !== null) throw new Error(`automations: record manual run: ${error.message}`);
}
