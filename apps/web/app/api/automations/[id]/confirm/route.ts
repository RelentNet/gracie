/**
 * POST /api/automations/:id/confirm — the CONFIRM step of confirm-before-acting
 * (P8 §2a/§5). This is the ONLY path that activates an automation; the Assistant
 * never does. It re-validates server-side, then flips `pending_confirmation` →
 * `active` and schedules it (a `once` that is due enqueues an immediate run).
 *
 * Body: `{ confirmExternal?: boolean }`.
 *
 * SAFETY (customer-contact exception, §2b): an automation flagged
 * `has_external_recipient` may ONLY be confirmed when ALL hold:
 *   1. the confirmer is an ADMIN (`automations.externalSend`),
 *   2. the `automations_external_send_enabled` master switch is ON,
 *   3. the request carries `confirmExternal: true` (the extra explicit confirmation).
 * Otherwise it is refused here — nothing external is scheduled. (The worker ALSO
 * re-checks the master switch at run time, so turning it off later still blocks sends.)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can, firstRunAt, isAutomationType, parseSchedule } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { gateAutomationMutation } from '@/lib/automations-access';
import { activateAutomation, getAutomationsExternalSendEnabled } from '@/lib/data/automations';
import { enqueueAutomationRun } from '@/lib/queue';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { id } = await params;
    const gate = await gateAutomationMutation(user, id);
    if (!gate.ok) return jsonError(gate.code, gate.message, gate.status);
    const row = gate.row;

    if (row.status !== 'pending_confirmation') {
      return jsonError('conflict', 'This automation has already been confirmed or cancelled', 409);
    }

    // Re-validate the persisted shape (never trust that it was well-formed at create).
    if (!isAutomationType(row.type)) {
      return jsonError('unprocessable', 'Automation type is not in the catalog', 422);
    }
    const parsed = parseSchedule(row.schedule);
    if (!('schedule' in parsed)) {
      return jsonError('unprocessable', `Invalid schedule: ${parsed.error}`, 422);
    }
    const schedule = parsed.schedule;

    // Re-assert the type↔schedule invariant create_automation enforces: an event
    // schedule is only valid for meeting_brief, and vice versa. Guards against a
    // malformed persisted row activating into a shape neither run path handles.
    if ((schedule.kind === 'event') !== (row.type === 'meeting_brief')) {
      return jsonError('unprocessable', 'Automation type and trigger do not match', 422);
    }

    // --- customer-contact exception gate (§2b) ---
    if (row.has_external_recipient) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (!isAdmin(user) || !can(user.role, 'automations.externalSend')) {
        return jsonError('forbidden', 'Only an admin can confirm an automation that emails an external recipient', 403);
      }
      if (!(await getAutomationsExternalSendEnabled())) {
        return jsonError(
          'external_send_disabled',
          'External sending is turned off. An admin must enable it in Settings → Automations first.',
          409,
        );
      }
      if (body.confirmExternal !== true) {
        return jsonError(
          'external_confirmation_required',
          'This automation emails a client directly. Re-confirm to approve the external send.',
          428,
        );
      }
    }

    const now = new Date();

    // A "once, now" automation fires immediately via an enqueued run rather than
    // waiting up to a sweep. Crucially, its `next_run_at` is set to null so the
    // sweep can NEVER also pick it up — the enqueued run is the SOLE execution path
    // (no double send, which matters most for an external client_send).
    const runImmediately = schedule.kind === 'once' && Date.parse(schedule.runAt) <= now.getTime();
    const nextRunAt = runImmediately ? null : firstRunAt(schedule, now);
    const automation = await activateAutomation(id, nextRunAt);

    let enqueued = false;
    if (runImmediately) {
      await enqueueAutomationRun(id);
      enqueued = true;
    }

    return NextResponse.json({ automation, enqueued });
  } catch (error) {
    return jsonError('automation_confirm_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
