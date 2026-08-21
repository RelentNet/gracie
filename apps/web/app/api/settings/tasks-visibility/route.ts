/**
 * Admin-only Task-Board VISIBILITY toggle (Settings → Company). Reads/writes the
 * display-only `task_board_visible_to_all` setting. When off (the default), the
 * cross-client Task Board is admin-only; turning it on reveals it to every user
 * (nav item, page, and the list/export APIs all honour the same flag).
 *
 *   GET   → `{ visible }`
 *   PATCH → `{ visible: boolean }` → `{ visible }`
 *
 * Gated on `settings.access` (admin tier) on both read and write — this lives in
 * the admin-only Settings area.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { getTaskBoardVisibleToAll, setTaskBoardVisibleToAll } from '@/lib/data/tasks';

// @gracie/db (service-role client) is Node-only.
export const runtime = 'nodejs';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'settings.access')) return forbidden();
    return NextResponse.json({ visible: await getTaskBoardVisibleToAll() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'tasks_visibility_read_failed', message } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'settings.access')) return forbidden();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.visible !== 'boolean') {
      return NextResponse.json({ error: { code: 'bad_request', message: 'visible must be a boolean.' } }, { status: 400 });
    }

    // `user.userId` is the Logto id; settings.updated_by_user_id is the internal uuid.
    const byUserId = await getUserIdByLogtoId(user.userId);
    return NextResponse.json({ visible: await setTaskBoardVisibleToAll(body.visible, byUserId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'tasks_visibility_write_failed', message } }, { status: 500 });
  }
}
