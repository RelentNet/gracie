/**
 * GET /api/calendar?from=&to= — meetings in a date range for the month grid +
 * day detail (docs/05 Calendar, docs/08 §M7). Any role. `from`/`to` are ISO
 * instants; when omitted, a wide default window is used so a bare fetch still
 * returns the near-term schedule.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { listCalendarMeetings } from '@/lib/data/calendar';

/** Default window when the caller omits from/to: last 31 days → next 62 days. */
function defaultWindow(): { fromIso: string; toIso: string } {
  const now = Date.now();
  return {
    fromIso: new Date(now - 31 * 86_400_000).toISOString(),
    toIso: new Date(now + 62 * 86_400_000).toISOString(),
  };
}

/** Validate an ISO date param, or null if absent/unparseable. */
function parseIso(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await getRequestUser();
    const defaults = defaultWindow();
    const fromIso = parseIso(request.nextUrl.searchParams.get('from')) ?? defaults.fromIso;
    const toIso = parseIso(request.nextUrl.searchParams.get('to')) ?? defaults.toIso;
    const meetings = await listCalendarMeetings(fromIso, toIso);
    return NextResponse.json({ meetings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'calendar_list_failed', message } }, { status: 500 });
  }
}
