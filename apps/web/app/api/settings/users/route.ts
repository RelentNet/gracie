/**
 * GET /api/settings/users — list every user for Settings → Users. ADMIN-ONLY
 * (`users.manage`, docs/02 D14). Also returns the requester's own `users.id` so
 * the UI can mark "you" and confirm self role-changes. Never returns secrets.
 */
import { NextResponse } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { getUserIdByLogtoId, listUsers } from '@/lib/data/users';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  let currentLogtoId: string;
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'users.manage')) {
      return jsonError('forbidden', 'Admin role required', 403);
    }
    currentLogtoId = user.userId;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const [users, currentUserId] = await Promise.all([
      listUsers(),
      getUserIdByLogtoId(currentLogtoId),
    ]);
    return NextResponse.json({ users, currentUserId });
  } catch (error) {
    return jsonError(
      'users_list_failed',
      error instanceof Error ? error.message : 'Unknown error',
      500,
    );
  }
}
