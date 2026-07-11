/**
 * Per-automation routes (P8). `:id` is the `automations.id`.
 *   GET    → the automation + its recent runs (view/own-or-admin).
 *   PATCH  → `{ paused: boolean }` — pause / resume (edit/own-or-admin).
 *   DELETE → remove the automation + its runs (edit/own-or-admin).
 *
 * Confirm (activate), cancel (delete a pending proposal), and run-now live in the
 * dedicated sub-routes so each keeps its own gating.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can, firstRunAt, parseSchedule } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { gateAutomationMutation } from '@/lib/automations-access';
import {
  deleteAutomation,
  getAutomation,
  getAutomationRow,
  listAutomationRuns,
  setAutomationPaused,
} from '@/lib/data/automations';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!can(user.role, 'automations.view')) return jsonError('forbidden', 'Not permitted', 403);

  try {
    const { id } = await params;
    const row = await getAutomationRow(id);
    // 404 (not 403) for a non-owner non-admin so ids aren't probeable.
    if (row === null || (row.owner_user_id !== user.userId && !isAdmin(user))) {
      return jsonError('not_found', 'Automation not found', 404);
    }
    const automation = await getAutomation(id);
    const runs = await listAutomationRuns(id, 20);
    return NextResponse.json({ automation, runs });
  } catch (error) {
    return jsonError('automation_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.paused !== 'boolean') return jsonError('bad_request', 'paused (boolean) is required', 400);
    if (gate.row.status === 'pending_confirmation' || gate.row.status === 'cancelled') {
      return jsonError('conflict', 'Only a confirmed automation can be paused or resumed', 409);
    }

    // Re-anchor the schedule on resume so a long-paused automation fires next, not a backlog.
    let nextRunAt: string | null = gate.row.next_run_at;
    if (!body.paused) {
      const parsed = parseSchedule(gate.row.schedule);
      nextRunAt = 'schedule' in parsed ? firstRunAt(parsed.schedule, new Date()) : null;
    }
    const automation = await setAutomationPaused(id, body.paused, nextRunAt);
    return NextResponse.json({ automation });
  } catch (error) {
    return jsonError('automation_update_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
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
    await deleteAutomation(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError('automation_delete_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
