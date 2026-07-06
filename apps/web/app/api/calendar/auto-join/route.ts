/**
 * Per-user "auto-join my meetings" opt-out (P4, docs/09 Phase 4). Any role — a
 * user controls whether the Recall bot auto-joins the meetings THEY lead.
 *
 *   GET   → `{ autoJoinMeetings }` for the current user (default true).
 *   PATCH → `{ enabled: boolean }` sets it; 404 if the session maps to no user
 *           profile (e.g. local mock auth without a matching `users` row).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { getAutoJoin, setAutoJoin } from '@/lib/data/calendar';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const autoJoinMeetings = await getAutoJoin(user.userId);
    return NextResponse.json({ autoJoinMeetings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'auto_join_read_failed', message } }, { status: 500 });
  }
}

interface AutoJoinBody {
  readonly enabled?: unknown;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const body = (await request.json().catch(() => ({}))) as AutoJoinBody;
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'enabled (boolean) is required' } },
        { status: 400 },
      );
    }
    const result = await setAutoJoin(user.userId, body.enabled);
    if (!result.updated) {
      return NextResponse.json(
        { error: { code: 'no_profile', message: 'No user profile for the current session' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ autoJoinMeetings: result.value });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'auto_join_write_failed', message } }, { status: 500 });
  }
}
