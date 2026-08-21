/**
 * GET /api/tasks/export — download the cross-client Task Board as `text/csv`
 * (`?archived=true` includes archived tasks). Admin-only, matching the board's
 * `task.manageBoard` gate and `GET /api/tasks` — regular staff reach tasks through
 * the Assistant, not this global export.
 *
 * Columns: client, description, owner, priority, status, created/updated/due dates.
 * Client + owner ids are resolved to names here; the pure shaping lives in
 * lib/data/tasks-report.ts (unit-tested).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { CLIENT_TYPES } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { attachmentDisposition } from '@/lib/content-disposition';
import { listClients } from '@/lib/data/clients';
import { getTaskBoardVisibleToAll, listTasks } from '@/lib/data/tasks';
import { tasksToCsv } from '@/lib/data/tasks-report';
import { listAssignableUsers } from '@/lib/data/users';

// Data layer pulls in Node-only deps (service-role client) — force the Node runtime.
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Admin-only unless the operator has revealed the board to everyone (the export
    // button rides along with the board). Fail closed on a settings-read blip.
    const user = await getRequestUser();
    if (!isAdmin(user) && !(await getTaskBoardVisibleToAll().catch(() => false))) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Administrator access required' } },
        { status: 403 },
      );
    }
    const includeArchived = request.nextUrl.searchParams.get('archived') === 'true';

    const [tasks, clients, users] = await Promise.all([
      listTasks({ includeArchived }),
      listClients([...CLIENT_TYPES]),
      listAssignableUsers(),
    ]);

    const clientNames = new Map(clients.map((c) => [c.id, c.name]));
    const ownerNames = new Map(users.map((u) => [u.id, u.name]));
    const csv = tasksToCsv(tasks, clientNames, ownerNames);
    const filename = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': attachmentDisposition(filename),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'tasks_export_failed', message } }, { status: 500 });
  }
}
