/**
 * POST /api/automations/:id/cancel — cancel a PENDING proposal (the "No thanks" on
 * the confirm card). Deletes the `pending_confirmation` row so an unconfirmed
 * automation never lingers. Editor tier + owner-or-admin. Refuses to cancel an
 * already-active automation (use pause/delete for those).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { gateAutomationMutation } from '@/lib/automations-access';
import { deleteAutomation } from '@/lib/data/automations';

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
    if (gate.row.status !== 'pending_confirmation') {
      return jsonError('conflict', 'Only a pending proposal can be cancelled', 409);
    }
    await deleteAutomation(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError('automation_cancel_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
