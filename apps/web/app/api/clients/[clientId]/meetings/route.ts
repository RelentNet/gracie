/**
 * GET /api/clients/:clientId/meetings — every meeting on file for this client (the
 * client profile's Meetings tab splits them into upcoming / previous). Any
 * authenticated role: all staff see all clients.
 */
import { NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/api-auth';
import { getClientMeetings } from '@/lib/data/client-detail';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  const authed = await requireRequestUser();
  if (authed instanceof NextResponse) return authed;
  try {
    const { clientId } = await params;
    return NextResponse.json({ meetings: await getClientMeetings(clientId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_meetings_failed', message } },
      { status: 500 },
    );
  }
}
