/**
 * PATCH /api/support/:id  { status: 'open' | 'done' } — admin only (Settings → Support).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isAdmin, requireRequestUser } from '@/lib/api-auth';
import { setSupportRequestStatus } from '@/lib/data/support';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status;
  if (status !== 'open' && status !== 'done') return jsonError('bad_request', 'status must be open or done', 400);

  try {
    const found = await setSupportRequestStatus(id, status);
    if (!found) return jsonError('not_found', 'Support request not found', 404);
    return NextResponse.json({ id, status });
  } catch (error) {
    return jsonError('support_update_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
