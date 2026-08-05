/**
 * POST /api/calendar/meetings/[id]/redispatch — manual re-dispatch of a Recall bot
 * to an EXISTING meeting's stored join link. The on-demand counterpart to
 * `/api/calendar/join`, but bound to a known meeting instead of a pasted URL: it
 * reuses the exact dispatch core (`dispatchRecallBot` + `getBotConfig`) via
 * `redispatchMeetingBot`, and overwrites the meeting's `bot_job_id`.
 *
 * Use case: a meeting starts LATE, the auto-dispatched bot has already timed out /
 * auto-left, and there's no recording — anyone fires a fresh bot with one click.
 * It therefore DELIBERATELY bypasses the "already dispatched" guard.
 *
 * Gate — any authenticated user (no admin, no master switch). Rejects a meeting
 * with no join link (400).
 */
import { NextResponse } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { redispatchMeetingBot } from '@/lib/data/calendar';

// @gracie/db (service-role) + a synchronous outbound Recall dispatch — Node only.
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // Any authenticated user — getRequestUser throws 'unauthorized' (→ 401) if not.
    await getRequestUser();

    const { id } = await params;
    const result = await redispatchMeetingBot(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message === 'unauthorized'
        ? 401
        : message === 'Unknown meeting'
          ? 404
          : message === 'This meeting has no join link.'
            ? 400
            : 500;
    return NextResponse.json({ error: { code: 'redispatch_failed', message } }, { status });
  }
}
