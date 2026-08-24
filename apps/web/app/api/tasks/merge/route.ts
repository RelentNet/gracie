/**
 * POST /api/tasks/merge { primaryId, mergedIds: string[] } — merge 2+ same-client tasks
 * into the primary (ADMIN ONLY, tasks lifecycle). The primary survives with the merged-away
 * descriptions + notes folded in and the highest priority among them; the others are deleted.
 * A cross-client selection is rejected (a task belongs to one client). Returns the survivor.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { mergeTasks } from '@/lib/data/tasks';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Administrator access required' } },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { primaryId, mergedIds } = body;
    if (typeof primaryId !== 'string' || primaryId === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A primary task is required.' } },
        { status: 400 },
      );
    }
    if (!Array.isArray(mergedIds) || !mergedIds.every((id) => typeof id === 'string' && id !== '')) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Provide the tasks to merge in.' } },
        { status: 400 },
      );
    }
    // Dedupe and drop the primary from the merged-away set (self-merge is a no-op).
    const merged = Array.from(new Set(mergedIds as string[])).filter((id) => id !== primaryId);
    if (merged.length === 0) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Select at least two tasks to merge.' } },
        { status: 400 },
      );
    }

    const task = await mergeTasks(primaryId, merged);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message === 'Unknown task'
        ? 404
        : message === 'Merge only works within one client.'
          ? 400
          : 500;
    return NextResponse.json({ error: { code: 'tasks_merge_failed', message } }, { status });
  }
}
