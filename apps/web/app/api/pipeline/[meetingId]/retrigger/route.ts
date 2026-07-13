/**
 * Admin-only manual re-trigger (P9). Re-runs meeting-note generation for a failed
 * meeting by enqueuing a job on the SAME generation queue the Recall webhook uses —
 * it does NOT define a new pipeline. The generation processor is idempotent per
 * meeting (it clears prior transcript embeddings, tasks, and documents before
 * regenerating), so a re-run replaces rather than duplicates.
 *
 *   POST /api/pipeline/:meetingId/retrigger → `{ enqueued: true, jobId }`
 *
 * Gated on `pipeline.triggerManual` (admin tier); a non-admin receives 403. This is
 * unrelated to the bot dispatch kill-switch — no bot is dispatched; it only
 * regenerates from the meeting's already-recorded transcript.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { getMeetingForRetrigger, markMeetingProcessing } from '@/lib/data/pipeline';
import { enqueueGenerate } from '@/lib/queue';

// @gracie/db (service-role client) + BullMQ producer are Node-only.
export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!can(user.role, 'pipeline.triggerManual')) return jsonError('forbidden', 'Admin only', 403);

  const { meetingId } = await params;
  if (typeof meetingId !== 'string' || meetingId === '') {
    return jsonError('bad_request', 'meetingId is required', 400);
  }

  try {
    const meeting = await getMeetingForRetrigger(meetingId);
    if (meeting === null) return jsonError('not_found', 'Meeting not found', 404);
    if (meeting.botJobId === null || meeting.botJobId === '') {
      return jsonError('no_recording', 'This meeting has no bot recording to regenerate from.', 400);
    }

    const jobId = await enqueueGenerate({ meetingId: meeting.id, botJobId: meeting.botJobId });
    // Reflect in-progress in the UI (best-effort; the processor also sets status).
    await markMeetingProcessing(meeting.id).catch(() => undefined);

    return NextResponse.json({ enqueued: true, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('pipeline_retrigger_failed', message, 500);
  }
}
