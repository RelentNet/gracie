/**
 * POST /api/automations/:id/run — "Run now" (P8 §6). Enqueues an immediate single
 * run of an already-confirmed automation, regardless of its schedule; the worker
 * runs it once and logs an `automation_runs` row (a recurring automation's schedule
 * is untouched). Editor tier + owner-or-admin.
 *
 * A `client_send` (external) automation is still RE-GATED at run time by the worker
 * (the master switch is re-checked), so Run-now cannot bypass the customer exception.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { gateAutomationMutation } from '@/lib/automations-access';
import { enqueueAutomationRun } from '@/lib/queue';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params): Promise<NextResponse> {
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
    if (gate.row.status !== 'active' && gate.row.status !== 'paused') {
      return jsonError('conflict', 'Confirm the automation before running it', 409);
    }
    const jobId = await enqueueAutomationRun(id);
    return NextResponse.json({ ok: true, jobId }, { status: 202 });
  } catch (error) {
    return jsonError('automation_run_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
