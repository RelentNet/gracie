/**
 * GET /api/automations/requests — the admin "advanced requests" inbox (P8 §6).
 * Lists out-of-catalog automation requests Gracie flagged for a human (newest
 * first, with requester names). Admin only. An optional `?status=pending` filters.
 *
 * Requests are CREATED by the Assistant's `request_advanced_automation` tool, not a
 * route — this endpoint is read/triage only (resolve via the `[id]` PATCH).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { listAutomationRequests } from '@/lib/data/automations';
import type { AutomationRequestStatus } from '@gracie/shared';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

const VALID_STATUSES: readonly AutomationRequestStatus[] = ['pending', 'accepted', 'dismissed'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  try {
    const statusParam = req.nextUrl.searchParams.get('status');
    const status =
      statusParam !== null && (VALID_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as AutomationRequestStatus)
        : undefined;
    const requests = await listAutomationRequests(status);
    return NextResponse.json({ requests });
  } catch (error) {
    return jsonError('automation_requests_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
