/**
 * Admin-only client-health-score VISIBILITY toggle (Settings → Scoring). Reads/writes
 * the display-only `client_health_scores_visible` setting. Unlike the scoring-config
 * route, saving here does NOT enqueue a recompute — it only hides/shows the number the
 * worker already computes.
 *
 *   GET   → `{ visible }`
 *   PATCH → `{ visible: boolean }` → `{ visible }`
 *
 * Gated on `scoring.configure` (admin tier) on both read and write.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { getHealthScoresVisible, setHealthScoresVisible } from '@/lib/data/scoring-settings';

// @gracie/db (service-role client) is Node-only.
export const runtime = 'nodejs';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'scoring.configure')) return forbidden();
    return NextResponse.json({ visible: await getHealthScoresVisible() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'health_visibility_read_failed', message } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'scoring.configure')) return forbidden();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.visible !== 'boolean') {
      return NextResponse.json({ error: { code: 'bad_request', message: 'visible must be a boolean.' } }, { status: 400 });
    }

    // `user.userId` is the Logto id; settings.updated_by_user_id is the internal uuid.
    const byUserId = await getUserIdByLogtoId(user.userId);
    return NextResponse.json({ visible: await setHealthScoresVisible(body.visible, byUserId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'health_visibility_write_failed', message } }, { status: 500 });
  }
}
