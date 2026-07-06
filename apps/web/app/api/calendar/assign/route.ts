/**
 * POST /api/calendar/assign — resolve an ambiguous meeting by assigning a client
 * (docs/05). Admin only. Body: `{ meetingId, clientId }`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { assignMeetingClient } from '@/lib/data/calendar';

interface AssignBody {
  readonly meetingId?: unknown;
  readonly clientId?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as AssignBody;
    if (typeof body.meetingId !== 'string' || typeof body.clientId !== 'string') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'meetingId and clientId are required' } },
        { status: 400 },
      );
    }
    await assignMeetingClient(body.meetingId, body.clientId);
    return NextResponse.json({ assigned: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown client' || message === 'Unknown meeting' ? 404 : 500;
    return NextResponse.json({ error: { code: 'calendar_assign_failed', message } }, { status });
  }
}
