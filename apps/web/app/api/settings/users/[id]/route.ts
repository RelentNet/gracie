/**
 * PATCH /api/settings/users/:id — change a user's role and/or deactivate /
 * reactivate them. ADMIN-ONLY (`users.manage`, docs/02 D14). `:id` is the target
 * `users.id`.
 *
 * Body: `{ role?: Role, deactivated?: boolean }` — at least one field required.
 * Approach B: a role change is a plain `UPDATE users` and takes effect on the
 * target's next request (no re-login). Anti-lockout guards live in the data layer
 * (last active admin) and surface here as HTTP 409.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can, isRole } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { UserAdminError, setUserActive, setUserRole } from '@/lib/data/users';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    if (!can((await getRequestUser()).role, 'users.manage')) {
      return jsonError('forbidden', 'Admin role required', 403);
    }
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { id } = await params;
    if (id === '') return jsonError('bad_request', 'user id is required', 400);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const hasRole = 'role' in body;
    const hasDeactivated = 'deactivated' in body;
    if (!hasRole && !hasDeactivated) {
      return jsonError('bad_request', 'Provide `role` and/or `deactivated`.', 400);
    }
    if (hasRole && !isRole(body.role)) {
      return jsonError('bad_request', 'Invalid role.', 400);
    }
    if (hasDeactivated && typeof body.deactivated !== 'boolean') {
      return jsonError('bad_request', '`deactivated` must be a boolean.', 400);
    }

    if (isRole(body.role)) {
      await setUserRole(id, body.role);
    }
    if (typeof body.deactivated === 'boolean') {
      await setUserActive(id, !body.deactivated);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserAdminError) {
      return jsonError(error.code, error.message, error.status);
    }
    return jsonError(
      'user_update_failed',
      error instanceof Error ? error.message : 'Unknown error',
      500,
    );
  }
}
