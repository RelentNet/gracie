/**
 * GET  /api/tasks — list tasks across all clients (`?archived=true` includes archived).
 * POST /api/tasks { clientId, description, ownerUserId?, dueDate?, priorityFlag? } —
 *      create a manual, client-scoped task (editor tier; viewers are read-only).
 *
 * Reads/writes via the service-role data layer. Tasks carry no admin-only fields, so
 * no redaction is needed. A create enqueues a best-effort health recompute (tasks feed
 * the open/overdue + completion signals).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { createTask, listTasks } from '@/lib/data/tasks';
import { enqueueRelationshipHealth } from '@/lib/queue';

// bullmq/ioredis (the recompute enqueue) are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await getRequestUser();
    const includeArchived = request.nextUrl.searchParams.get('archived') === 'true';
    const tasks = await listTasks({ includeArchived });
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'tasks_list_failed', message } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isEditor(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Editor access required' } },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.clientId !== 'string' || body.clientId.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A client is required.' } },
        { status: 400 },
      );
    }
    if (typeof body.description !== 'string' || body.description.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A task description is required.' } },
        { status: 400 },
      );
    }
    if (body.dueDate !== undefined && body.dueDate !== null) {
      if (typeof body.dueDate !== 'string' || !ISO_DATE_RE.test(body.dueDate)) {
        return NextResponse.json(
          { error: { code: 'bad_request', message: 'Due date must be YYYY-MM-DD.' } },
          { status: 400 },
        );
      }
    }
    const ownerUserId =
      typeof body.ownerUserId === 'string' && body.ownerUserId.trim() !== '' ? body.ownerUserId : null;

    const task = await createTask({
      clientId: body.clientId,
      description: body.description,
      ownerUserId,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : null,
      priorityFlag: body.priorityFlag === true,
    });

    try {
      await enqueueRelationshipHealth(task.clientId, 'task');
    } catch (enqueueError) {
      console.warn('task POST: health recompute enqueue failed', enqueueError);
    }

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'task_create_failed', message } },
      { status: 500 },
    );
  }
}
