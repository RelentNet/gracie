/**
 * POST /api/calendar/join — on-demand meeting join (P4.2). An authenticated
 * staffer pastes a meeting link and Gracie joins + records it immediately, for
 * impromptu meetings not on the calendar. Body: `{ url, title?, clientId? }`.
 *
 * This is the EXPLICIT, human-triggered counterpart to the auto-dispatch cron:
 * it creates a `source: 'manual'` meeting and dispatches a Recall bot NOW
 * (synchronously, for instant feedback), BYPASSING the auto kill-switch and the
 * bot-eligibility filter. Its own gate is the `manual_join_enabled` master switch
 * (Admin-controlled, fail-safe OFF) plus the per-action confirmation in the UI.
 * The recording flows through the existing P5b webhook → generation pipeline, so
 * it yields the same notes/docs/tasks as any calendar meeting.
 *
 * Any signed-in user may trigger a join once the master switch is on; a missing
 * session is rejected. Fail-safe: a failed dispatch rolls back the meeting row
 * (handled in `joinMeetingNow`) and the error is returned to the UI.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { getManualJoinEnabled, joinMeetingNow } from '@/lib/data/calendar';
import { getUserIdByLogtoId } from '@/lib/data/users';

// @gracie/db (service-role) + a synchronous outbound Recall dispatch — Node only.
export const runtime = 'nodejs';

interface JoinBody {
  readonly url?: unknown;
  readonly title?: unknown;
  readonly clientId?: unknown;
}

/**
 * A "plausible" meeting join URL: parseable, http(s), with a dotted host. Kept
 * permissive on purpose — Recall dials many platforms (Zoom, Meet, Teams, Webex,
 * …), so the guard rejects obvious junk without gatekeeping specific providers.
 */
function isPlausibleMeetingUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return parsed.hostname.includes('.');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();

    // Master switch (independent of the auto kill-switch). Defense-in-depth: the
    // UI already hides the control when off, but never trust the client.
    if (!(await getManualJoinEnabled())) {
      return NextResponse.json(
        {
          error: {
            code: 'manual_join_disabled',
            message: 'On-demand meeting join is turned off. An admin can enable it in Calendar settings.',
          },
        },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as JoinBody;
    if (typeof body.url !== 'string' || !isPlausibleMeetingUrl(body.url)) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A valid meeting URL is required.' } },
        { status: 400 },
      );
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'title must be a string.' } },
        { status: 400 },
      );
    }
    if (body.clientId !== undefined && body.clientId !== null && typeof body.clientId !== 'string') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'clientId must be a string.' } },
        { status: 400 },
      );
    }

    // The lead is the triggering staffer. Resolve their `users.id` from the
    // session; null when the session maps to no profile (e.g. local mock auth).
    const leadUserId = await getUserIdByLogtoId(user.userId);

    const meeting = await joinMeetingNow({
      url: body.url,
      title: typeof body.title === 'string' ? body.title : null,
      clientId: typeof body.clientId === 'string' ? body.clientId : null,
      leadUserId,
    });
    return NextResponse.json({ meeting });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'unauthorized' ? 401 : message === 'Unknown client' ? 404 : 500;
    return NextResponse.json({ error: { code: 'calendar_join_failed', message } }, { status });
  }
}
