/**
 * POST /api/calendar/meetings/[id]/ignore — put this meeting on (or take it off) the
 * meeting-bot "don't record" ignore list (the ghost-meeting guard). Body:
 *   `{ ignore: true }`  → skip Gracie for this meeting's whole recurring series
 *                         (or one-off join link).
 *   `{ ignore: false }` → resume recording it.
 *
 * The server resolves the meeting's stable key (recurring `series_id` when present,
 * else the join link) and human label from the meeting id, so the client never has to
 * know either. The worker's bot-dispatch sweep honours the list on its next pass.
 *
 * Gate — Admin only (a bot-dispatch config action, like the kill-switch); non-admins
 * get a 403. Reversible with no data loss: turning it back on re-enables dispatch.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { setMeetingIgnored } from '@/lib/data/calendar';

// @gracie/db (service-role) — Node only.
export const runtime = 'nodejs';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

interface IgnoreBody {
  readonly ignore?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // getRequestUser throws 'unauthorized' (→ 401) when there's no valid session.
    if (!isAdmin(await getRequestUser())) return forbidden();

    const body = (await request.json().catch(() => ({}))) as IgnoreBody;
    if (typeof body.ignore !== 'boolean') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'ignore (boolean) is required' } },
        { status: 400 },
      );
    }

    const { id } = await params;
    const result = await setMeetingIgnored(id, body.ignore);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message === 'unauthorized'
        ? 401
        : message === 'Unknown meeting'
          ? 404
          : message === 'This meeting has no recurring series or join link.'
            ? 400
            : 500;
    return NextResponse.json({ error: { code: 'ignore_failed', message } }, { status });
  }
}
