/**
 * GET /api/clients/:clientId/overview — Overview tab data.
 *
 * Returns the role-redacted client, its latest meeting, and the top open tasks.
 * Admin-only client fields (fee tier, contract value) are gated by role
 * (docs/02 §D14). Auth resolves to the mock user via getRequestUser().
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { redactClientForRole } from '@/lib/data/clients';
import {
  getClientDetail,
  getClientTasks,
  getLatestClientMeeting,
} from '@/lib/data/client-detail';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const { clientId } = await params;
    const client = await getClientDetail(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'client_not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    const admin = isAdmin(await getRequestUser());
    const [lastMeeting, tasks] = await Promise.all([
      getLatestClientMeeting(clientId),
      getClientTasks(clientId),
    ]);
    const topTasks = tasks.filter((task) => task.status !== 'complete').slice(0, 3);
    return NextResponse.json({
      client: redactClientForRole(client, admin),
      lastMeeting,
      topTasks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_overview_failed', message } },
      { status: 500 },
    );
  }
}
