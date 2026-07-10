/**
 * PATCH /api/notifications/read — mark the current user's notifications read.
 *   body { all: true }        → mark ALL unread read
 *   body { ids: string[] }    → mark those ids read (caller-scoped)
 *
 * Caller-scoped ONLY: the owner id is the resolved `users.id` from the verified
 * session; the data layer additionally filters `.eq('user_id', self)`, so a caller
 * can never mark another user's rows read. Any role.
 */
import { NextResponse } from 'next/server';

import { markAllRead, markRead } from '@/lib/data/notifications';
import { getSessionUser } from '@/lib/session-user';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  let userId: string;
  try {
    userId = (await getSessionUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { all?: unknown; ids?: unknown };
    if (body.all === true) {
      await markAllRead(userId);
      return NextResponse.json({ ok: true });
    }
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id): id is string => typeof id === 'string');
      await markRead(userId, ids);
      return NextResponse.json({ ok: true });
    }
    return jsonError('bad_request', 'Provide { all: true } or { ids: string[] }.', 400);
  } catch (error) {
    return jsonError('mark_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
