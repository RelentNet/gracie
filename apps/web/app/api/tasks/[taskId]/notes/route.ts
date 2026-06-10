/**
 * GET /api/tasks/[taskId]/notes — list the note feed for a task.
 *
 * Reads via the service-role data layer. Auth currently resolves to the mock
 * user via getRequestUser() — replaced by Logto JWT verification later.
 */
import { NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { getTaskNotes } from '@/lib/data/tasks';

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    await getRequestUser();
    const { taskId } = await context.params;
    const notes = await getTaskNotes(taskId);
    return NextResponse.json({ notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'task_notes_list_failed', message } },
      { status: 500 },
    );
  }
}
