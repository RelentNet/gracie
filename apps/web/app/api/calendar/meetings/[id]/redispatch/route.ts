/**
 * POST /api/calendar/meetings/[id]/redispatch — manual re-dispatch of a Recall bot
 * to an EXISTING meeting's stored join link. The on-demand counterpart to
 * `/api/calendar/join`, but bound to a known meeting instead of a pasted URL: it
 * reuses the exact dispatch core (`dispatchRecallBot` + `getBotConfig`) via
 * `redispatchMeetingBot`, and overwrites the meeting's `bot_job_id`.
 *
 * Use case: a meeting starts LATE, the auto-dispatched bot has already timed out /
 * auto-left, and there's no recording — the operator fires a fresh bot with one
 * click. It therefore DELIBERATELY bypasses the "already dispatched" guard.
 *
 * Gate — identical to the on-demand join: Admin only AND the `manual_join_enabled`
 * master switch ON (fail-safe OFF). Rejects a meeting with no join link (400).
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getManualJoinEnabled, redispatchMeetingBot } from '@/lib/data/calendar';

// @gracie/db (service-role) + a synchronous outbound Recall dispatch — Node only.
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }

    // Master switch (independent of the auto kill-switch). Defense-in-depth: the UI
    // already hides the control when off, but never trust the client.
    if (!(await getManualJoinEnabled())) {
      return NextResponse.json(
        {
          error: {
            code: 'manual_join_disabled',
            message: 'On-demand meeting join is turned off. An admin can enable it in Settings → Meeting Bot.',
          },
        },
        { status: 403 },
      );
    }

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
