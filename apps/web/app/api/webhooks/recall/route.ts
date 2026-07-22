/**
 * POST /api/webhooks/recall — Recall.ai "transcript ready" webhook (docs/05
 * Webhooks, docs/06 §4). Signature-verified (Svix); NOT user-authenticated.
 *
 * Flow: verify the signature → parse the event + `bot_job_id` → match the
 * `meetings` row by `bot_job_id` (else 4xx reject) → then:
 *   - `recording.done` → request the async transcript on the finished recording
 *     (`ensureAsyncTranscript`; `recallai` bots dispatch record-only because
 *     create-bot rejects `recallai_async` on our account) and flip the meeting
 *     to `awaiting_transcript` → 202.
 *   - `transcript.done` → enqueue a `generate` job → set
 *     `meetings.pipeline_status = 'processing'` → 202. The long-running
 *     6-document pipeline runs in apps/worker (docs/06 §9).
 *   - anything else → 200 no-op.
 * Register this endpoint in the Recall dashboard subscribed to BOTH
 * `recording.done` and `transcript.done`.
 *
 * DEPLOY FOLLOW-UP: `RECALL_WEBHOOK_SECRET` is not provisioned until the endpoint
 * is registered with Recall at deploy. While it is unset, signature verification
 * is SKIPPED with a logged warning so the meeting-matching path is still testable;
 * once the secret exists, every request must carry a valid signature.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getCredential, getServerClient } from '@gracie/db';
import { ensureAsyncTranscript } from '@gracie/shared/recall';

import { enqueueGenerate } from '@/lib/queue';
import {
  isRecordingDoneEvent,
  isTranscriptReadyEvent,
  parseRecallWebhook,
  readSvixHeaders,
  verifyRecallSignature,
} from '@/lib/recall-webhook';

// bullmq/ioredis + node:crypto are Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

function reject(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Raw body is required for signature verification — read it once as text.
  const body = await req.text();

  // 1. Signature verification (enforced only once the secret is provisioned).
  const secret = process.env.RECALL_WEBHOOK_SECRET ?? '';
  if (secret !== '') {
    // Recall sends the UNBRANDED Svix headers (`webhook-*`); `readSvixHeaders`
    // accepts both spellings. Reading only `svix-*` rejected every real delivery.
    const ok = verifyRecallSignature(
      secret,
      readSvixHeaders((name) => req.headers.get(name)),
      body,
    );
    if (!ok) {
      return reject(401, 'invalid_signature', 'Webhook signature verification failed');
    }
  } else {
    console.warn(
      '[webhooks/recall] RECALL_WEBHOOK_SECRET unset — skipping signature verification (deploy follow-up)',
    );
  }

  // 2. Parse the payload + extract the bot id.
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return reject(400, 'bad_request', 'Body is not valid JSON');
  }
  const { event, botJobId } = parseRecallWebhook(payload);
  if (botJobId === null) {
    return reject(400, 'bad_request', 'Payload is missing a bot id');
  }

  // 2b. Only two events matter: `recording.done` (request the async transcript —
  // `recallai` bots dispatch record-only because create-bot rejects
  // `recallai_async` on our account) and `transcript.done` (run generation).
  // Everything else — bot-status events etc. — is acknowledged (200) so Svix
  // does not retry, but ignored.
  const recordingDone = isRecordingDoneEvent(event);
  if (!recordingDone && !isTranscriptReadyEvent(event)) {
    return NextResponse.json({ accepted: true, ignored: true, event }, { status: 200 });
  }

  // 3. Confirm a meeting exists AND its bot_job_id matches (else 4xx reject).
  const db = getServerClient();
  const { data: meeting, error } = await db
    .from('meetings')
    .select('id')
    .eq('bot_job_id', botJobId)
    .maybeSingle();
  if (error !== null) {
    return reject(500, 'lookup_failed', error.message);
  }
  if (meeting === null) {
    return reject(404, 'meeting_not_found', `No meeting matches bot_job_id ${botJobId}`);
  }

  // 3b. Recording finished → make sure a transcript is on its way (idempotent —
  // a meeting_captions bot already has one; Svix retries are no-ops). A throw
  // here 500s so Svix retries. Status flips scheduled → awaiting_transcript so
  // the app can show "recorded, notes on the way" instead of a stale schedule.
  if (recordingDone) {
    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      return reject(500, 'no_recall_key', 'No Recall API key configured (Admin → API Settings)');
    }
    const result = await ensureAsyncTranscript(botJobId, {
      apiKey,
      region: process.env.RECALL_REGION,
    });
    await db
      .from('meetings')
      .update({ pipeline_status: 'awaiting_transcript' })
      .eq('id', meeting.id)
      .eq('pipeline_status', 'scheduled');
    return NextResponse.json({ accepted: true, meetingId: meeting.id, transcript: result }, { status: 202 });
  }

  // 4. Enqueue the generation job + mark the meeting processing, then 202.
  const jobId = await enqueueGenerate({ meetingId: meeting.id, botJobId });
  await db
    .from('meetings')
    .update({ pipeline_status: 'processing', pipeline_started_at: new Date().toISOString() })
    .eq('id', meeting.id);

  return NextResponse.json({ accepted: true, meetingId: meeting.id, jobId }, { status: 202 });
}
