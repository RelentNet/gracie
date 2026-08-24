/**
 * POST /api/tasks/bulk-delete { ids: string[] } — permanently delete many tasks at once
 * (ADMIN ONLY, tasks lifecycle). The bulk sibling of DELETE /api/tasks/:id, for clearing
 * an oversized Task Board fast. Archive stays the recoverable path; this is permanent.
 *
 * ponytail: no health recompute — same call as the single hard-delete (rare admin
 * cleanup, the nightly health sweep is the backstop).
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { deleteTasks } from '@/lib/data/tasks';

export const runtime = 'nodejs';

/** Guard rail so one bad request can't fire an unbounded delete. */
const MAX_BULK = 1000;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Administrator access required' } },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id !== '')) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Provide a non-empty list of task ids.' } },
        { status: 400 },
      );
    }
    if (ids.length > MAX_BULK) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: `Cannot delete more than ${MAX_BULK} tasks at once.` } },
        { status: 400 },
      );
    }
    const deleted = await deleteTasks(Array.from(new Set(ids as string[])));
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'tasks_bulk_delete_failed', message } }, { status: 500 });
  }
}
