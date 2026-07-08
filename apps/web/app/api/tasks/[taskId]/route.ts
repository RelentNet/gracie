/**
 * PATCH /api/tasks/:taskId — edit a task (P2.1).
 *
 * Editor tier (admin + standard); viewers are read-only. Handles description, owner,
 * due date, priority, status (open/in_progress/complete), and archive. Completing or
 * reopening a task, or changing its due date, enqueues a best-effort health recompute
 * for the owning client (tasks feed the open/overdue + completion signals). Returns the
 * updated task.
 */
import { NextResponse } from 'next/server';

import { TASK_STATUSES } from '@gracie/shared';
import type { TaskStatus } from '@gracie/shared';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { updateTask, type TaskPatch } from '@/lib/data/tasks';
import { enqueueRelationshipHealth } from '@/lib/queue';

// bullmq/ioredis (the recompute enqueue) are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    if (!isEditor(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Editor access required' } },
        { status: 403 },
      );
    }
    const { taskId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};

    if ('description' in body && body.description !== undefined) {
      if (typeof body.description !== 'string' || body.description.trim() === '') {
        return bad('Task description cannot be empty.');
      }
      patch.description = body.description;
    }
    if ('ownerUserId' in body && body.ownerUserId !== undefined) {
      if (body.ownerUserId !== null && typeof body.ownerUserId !== 'string') {
        return bad('Invalid owner.');
      }
      patch.ownerUserId =
        typeof body.ownerUserId === 'string' && body.ownerUserId.trim() !== '' ? body.ownerUserId : null;
    }
    if ('dueDate' in body && body.dueDate !== undefined) {
      if (body.dueDate !== null && (typeof body.dueDate !== 'string' || !ISO_DATE_RE.test(body.dueDate))) {
        return bad('Due date must be YYYY-MM-DD.');
      }
      patch.dueDate = body.dueDate as string | null;
    }
    if ('status' in body && body.status !== undefined) {
      if (typeof body.status !== 'string' || !(TASK_STATUSES as readonly string[]).includes(body.status)) {
        return bad('Invalid status.');
      }
      patch.status = body.status as TaskStatus;
    }
    if ('priorityFlag' in body && body.priorityFlag !== undefined) {
      if (typeof body.priorityFlag !== 'boolean') return bad('Invalid priority flag.');
      patch.priorityFlag = body.priorityFlag;
    }
    if ('archived' in body && body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') return bad('Invalid archived flag.');
      patch.archived = body.archived;
    }

    if (Object.keys(patch).length === 0) return bad('No editable fields provided.');

    const task = await updateTask(taskId, patch as TaskPatch);

    if (patch.status !== undefined || patch.dueDate !== undefined || patch.archived !== undefined) {
      try {
        await enqueueRelationshipHealth(task.clientId, 'task');
      } catch (enqueueError) {
        console.warn('task PATCH: health recompute enqueue failed', enqueueError);
      }
    }

    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown task' ? 404 : 500;
    return NextResponse.json({ error: { code: 'task_update_failed', message } }, { status });
  }
}
