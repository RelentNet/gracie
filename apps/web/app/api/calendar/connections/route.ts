/**
 * GET /api/calendar/connections — team calendar-connection status (docs/05).
 * "Connected" = membership in `MS_CALENDAR_GROUP_ID`, synced onto
 * `users.calendar_connected` by the worker scan (D5). Any role; Admins see the
 * whole team, everyone else sees only their own row.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getConnectionStatus } from '@/lib/data/calendar';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const status = await getConnectionStatus(user.userId, isAdmin(user));
    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'calendar_connections_failed', message } },
      { status: 500 },
    );
  }
}
