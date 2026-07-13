/**
 * GET /api/automations — list the caller's automations (an admin sees ALL, with
 * owner names). Any role may view (`automations.view`); the row scope is enforced
 * in the data layer by owner. Viewers are read-only — they can list but every
 * mutating route below requires `automations.edit`.
 *
 * Creation is deliberately NOT a route: automations are created only by the agentic
 * Assistant's `create_automation` tool (as `pending_confirmation`) and activated via
 * the gated confirm route — the confirm-before-acting guarantee.
 */
import { NextResponse } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { listAutomations } from '@/lib/data/automations';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!can(user.role, 'automations.view')) return jsonError('forbidden', 'Not permitted', 403);

  try {
    const automations = await listAutomations({ userId: user.userId, isAdmin: isAdmin(user) });
    return NextResponse.json({ automations, isAdmin: isAdmin(user) });
  } catch (error) {
    return jsonError('automations_list_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
