/**
 * PATCH /api/automations/requests/:id — resolve an advanced request (P8 §6). Admin
 * only. Body: `{ status: 'accepted' | 'dismissed', notes?: string }`. "Accepted"
 * just records the admin's decision (the actual build is manual / a future phase);
 * "dismissed" closes it. Stamps the resolver + timestamp for the audit trail.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { resolveAutomationRequest } from '@/lib/data/automations';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = body.status;
    if (status !== 'accepted' && status !== 'dismissed') {
      return jsonError('bad_request', "status must be 'accepted' or 'dismissed'", 400);
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
    const ok = await resolveAutomationRequest(id, { status, notes, resolvedByUserId: user.userId });
    if (!ok) return jsonError('not_found', 'Request not found', 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError('automation_request_resolve_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
