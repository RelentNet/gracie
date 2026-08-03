/**
 * Admin-only manual "Re-transcribe" (brief §3.2/§3.4). For a stuck meeting whose
 * RECORDING survived but whose transcript is missing/failed (the GA/Leap Metrics
 * `provider_connection_failed` case), this requests async transcription on the
 * existing recording; when it finishes, the Recall `transcript.done` webhook drives
 * generation exactly as normal. The self-heal watchdog does this automatically, so
 * this button is the fallback for the genuinely stuck.
 *
 *   POST /api/pipeline/:meetingId/retranscribe → `{ action, message }`
 *
 * A live Recall pre-flight (`classifyRecallRecoverability`) decides the outcome so we
 * never fire a request guaranteed to fail (brief §6):
 *   - `retranscribe`  → request async transcription, reset the meeting to awaiting.
 *   - `regenerate`    → the transcript is actually ready → re-queue generation instead.
 *   - `unrecoverable` → 400 with a plain-language reason (no recording to recover).
 *
 * Gated on `pipeline.triggerManual` (admin tier); a non-admin receives 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getCredential } from '@gracie/db';
import { can } from '@gracie/shared';
import { classifyRecallRecoverability, createRecallAsyncTranscript } from '@gracie/shared/recall';

import { getRequestUser } from '@/lib/api-auth';
import {
  getMeetingForRetrigger,
  markMeetingProcessing,
  markMeetingRetranscribing,
} from '@/lib/data/pipeline';
import { enqueueGenerate } from '@/lib/queue';

// @gracie/db (service-role client) + BullMQ producer + Recall fetch are Node-only.
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
      return jsonError('no_recording', 'No recording was captured — there’s nothing to recover.', 400);
    }

    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      return jsonError('no_recall_key', 'No Recall API key is configured (Admin → API Settings).', 500);
    }
    const region = process.env.RECALL_REGION;
    const recoverability = await classifyRecallRecoverability(meeting.botJobId, { apiKey, region });

    if (recoverability.state === 'regenerate') {
      // Transcript is actually ready — re-run generation rather than transcribe again.
      const jobId = await enqueueGenerate({ meetingId: meeting.id, botJobId: meeting.botJobId });
      await markMeetingProcessing(meeting.id).catch(() => undefined);
      return NextResponse.json({
        action: 'regenerate',
        jobId,
        message: 'The transcript was already ready — re-running note generation instead.',
      });
    }

    if (recoverability.state === 'unrecoverable' || recoverability.recordingId === null) {
      return jsonError('unrecoverable', 'No recording was captured — there’s nothing to recover.', 400);
    }

    await createRecallAsyncTranscript(recoverability.recordingId, { apiKey, region });
    await markMeetingRetranscribing(meeting.id);
    return NextResponse.json({
      action: 'retranscribe',
      message: 'Re-transcribing the recording. Notes will be created automatically when it’s ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('pipeline_retranscribe_failed', message, 500);
  }
}
