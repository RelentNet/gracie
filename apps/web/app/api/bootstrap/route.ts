import { NextResponse } from 'next/server';

import { getBrandLogoDarkKey, getBrandLogoKey } from '@/lib/data/branding-settings';
import { getHealthScoresVisible } from '@/lib/data/scoring-settings';
import { getTaskBoardVisibleToAll } from '@/lib/data/tasks';
import { isLogtoConfigured } from '@/lib/logto';
import { getCurrentUser } from '@/lib/server-auth';
import { GUEST_USER } from '@/lib/auth-shared';

/**
 * GET /api/bootstrap — what the app shell needs before it renders: the signed-in user
 * plus the firm-wide display settings the nav and pages gate on. This is exactly what
 * the Next.js root layout resolved on every page load; the SPA fetches it once at
 * startup and again on `router.refresh()`.
 *
 * 401 when Logto is configured and there is no valid session — the SPA turns that
 * into a redirect to /login (the old app-shell guard).
 */
export async function GET(): Promise<NextResponse> {
  // A settings-read blip must never fail the whole app — fail OPEN to visible (the
  // current behavior), matching the missing-value default. A logo-read blip falls
  // back to null → the nav's default text treatment.
  const [user, healthScoresVisible, taskBoardVisibleToAll, brandLogoKey, brandLogoDarkKey] =
    await Promise.all([
      getCurrentUser(),
      getHealthScoresVisible().catch(() => true),
      // Fall back to the default (admin-only) on a read blip — never reveal the board on error.
      getTaskBoardVisibleToAll().catch(() => false),
      getBrandLogoKey().catch(() => null),
      getBrandLogoDarkKey().catch(() => null),
    ]);

  if (isLogtoConfigured() && user.id === GUEST_USER.id) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Sign in required' } },
      { status: 401 },
    );
  }

  return NextResponse.json({
    user,
    healthScoresVisible,
    taskBoardVisibleToAll,
    brandLogoKey,
    brandLogoDarkKey,
  });
}
