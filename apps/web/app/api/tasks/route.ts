/**
 * GET /api/tasks — list tasks across all clients.
 *
 * Reads via the service-role data layer. Archived tasks are excluded by default;
 * pass `?archived=true` to include them (M6 "Show archived" toggle). Tasks carry
 * no admin-only fields, so no redaction is needed. Auth currently resolves to the
 * mock user via getRequestUser() — replaced by Logto JWT verification later.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { listTasks } from '@/lib/data/tasks';

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
