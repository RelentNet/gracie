/**
 * GET /api/clients/:clientId/operations — Operations tab data.
 *
 * Returns the client-scoped tasks (active board) and meetings (for the pipeline
 * run + transcript history panels). Requires a signed-in session (any role —
 * all staff see all clients); admin-only fields are not part of this payload.
 */
import { NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/api-auth';
import { getClientDetail, getClientMeetings, getClientTasks } from '@/lib/data/client-detail';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;

  try {
    const { clientId } = await params;
    const client = await getClientDetail(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'client_not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    const [tasks, meetings] = await Promise.all([
      getClientTasks(clientId),
      getClientMeetings(clientId),
    ]);
    return NextResponse.json({ tasks, meetings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_operations_failed', message } },
      { status: 500 },
    );
  }
}
