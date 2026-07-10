/**
 * GET /api/notifications — the current user's notifications + unread count.
 *
 * Caller-scoped ONLY: the owner id is the resolved `users.id` from the verified
 * session ({@link getSessionUser}), never a client-supplied value. `?unreadOnly=true`
 * limits the list to unread rows; `?limit=` bounds it. Any role.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getUnreadCount, listNotifications } from '@/lib/data/notifications';
import { getSessionUser } from '@/lib/session-user';

// @gracie/db (supabase-js, crypto) is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    userId = (await getSessionUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw !== null ? Number.parseInt(limitRaw, 10) : undefined;
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(userId, { unreadOnly, limit: Number.isFinite(limit) ? limit : undefined }),
      getUnreadCount(userId),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    return jsonError('notifications_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
