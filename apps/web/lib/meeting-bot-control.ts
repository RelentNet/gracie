/**
 * Shared handler for the live meeting-bot controls (`POST /api/meetings/[id]/{leave,pause,resume}`).
 * Each route is the same shape — resolve the meeting, get its `bot_job_id`, resolve
 * the Recall key + region, call the given bot helper — so the three routes differ
 * only by which {@link RecallFetchOptions} action they pass here.
 *
 * These are pure Recall bot-API calls: they work on ANY bot and are INDEPENDENT of
 * the transcript-provider / realtime kill-switch (nothing here reads or writes it).
 *
 * Gate — any authenticated user (matches the per-meeting "Send Gracie" re-dispatch,
 * PR #90/#94): `getRequestUser` throws `unauthorized` (→ 401) when there's no session.
 */
import { NextResponse } from 'next/server';

import { getCredential } from '@gracie/db';
import type { RecallFetchOptions } from '@gracie/shared/recall';

import { getRequestUser } from '@/lib/api-auth';
import { getMeetingForRetrigger } from '@/lib/data/pipeline';

/** A Recall bot lifecycle helper (leave / pause / resume). */
type BotAction = (botJobId: string, options: RecallFetchOptions) => Promise<void>;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Resolve the meeting's live bot and run `action` against it, returning `{ ok: true }`
 * or a clean error. A missing bot is a 404 ("Gracie is not in this meeting"), a missing
 * Recall key a 500, and any Recall failure a plain-language 500 the UI can show.
 */
export async function runBotControl(meetingId: string, action: BotAction): Promise<NextResponse> {
  try {
    await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (typeof meetingId !== 'string' || meetingId === '') {
    return jsonError('bad_request', 'meetingId is required', 400);
  }

  try {
    const meeting = await getMeetingForRetrigger(meetingId);
    if (meeting === null) return jsonError('not_found', 'Meeting not found', 404);
    if (meeting.botJobId === null || meeting.botJobId === '') {
      return jsonError('no_bot', 'Gracie is not in this meeting.', 404);
    }

    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      return jsonError('no_recall_key', 'No Recall API key is configured (Admin → API Settings).', 500);
    }

    await action(meeting.botJobId, { apiKey, region: process.env.RECALL_REGION });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('bot_control_failed', message, 500);
  }
}
