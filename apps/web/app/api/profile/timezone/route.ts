/**
 * Per-user profile timezone (self-service). ANY role — a user sets their OWN zone.
 *
 *   GET   → `{ timezone }` for the current user (null when unset).
 *   PATCH → `{ timezone }` (a valid IANA id) sets it; 400 on an invalid id, 404 if
 *           the session maps to no user profile (e.g. local mock auth).
 *
 * Drives the SSR/profile fallback for server-rendered timestamps and the
 * daily-sync email; the client UI otherwise renders in the device's local zone.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { getTimezoneByLogtoId, setTimezoneByLogtoId } from '@/lib/data/users';
import { isValidTimeZone } from '@/lib/timezones';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const timezone = await getTimezoneByLogtoId(user.userId);
    return NextResponse.json({ timezone });
  } catch (error) {
    return jsonError('timezone_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

interface TimezoneBody {
  readonly timezone?: unknown;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const body = (await request.json().catch(() => ({}))) as TimezoneBody;
    if (!isValidTimeZone(body.timezone)) {
      return jsonError('bad_request', 'A valid IANA timezone id is required.', 400);
    }
    const { updated } = await setTimezoneByLogtoId(user.userId, body.timezone);
    if (!updated) {
      return jsonError('no_profile', 'No user profile for the current session.', 404);
    }
    return NextResponse.json({ timezone: body.timezone });
  } catch (error) {
    return jsonError('timezone_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
