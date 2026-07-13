/**
 * POST /api/webhooks/recall — Recall.ai "transcript ready" webhook (docs/05
 * Webhooks, docs/06 §4). Signature-verified (Svix); NOT user-authenticated.
 *
 * Flow: verify the signature → parse the event + `bot_job_id` → ignore anything
 * that is not the `transcript.done` event (200, no-op) → confirm a `meetings` row
 * exists whose `bot_job_id` matches (else 4xx reject) → enqueue a `generate` job →
 * set `meetings.pipeline_status = 'processing'` → return 202 immediately. The
 * long-running 6-document pipeline runs in apps/worker (docs/06 §9).
 *
 * The bot is dispatched with a `recording_config.transcript` provider (see
 * `@gracie/shared/recall`), so Recall produces a transcript and fires
 * `transcript.done` when it is ready — the event this route generates on. Register
 * this endpoint in the Recall dashboard subscribed to `transcript.done`.
 *
 * DEPLOY FOLLOW-UP: `RECALL_WEBHOOK_SECRET` is not provisioned until the endpoint
 * is registered with Recall at deploy. While it is unset, signature verification
 * is SKIPPED with a logged warning so the meeting-matching path is still testable;
 * once the secret exists, every request must carry a valid signature.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getServerClient } from '@gracie/db';

import { enqueueGenerate } from '@/lib/queue';
import {
  isTranscriptReadyEvent,
  parseRecallWebhook,
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
    const ok = verifyRecallSignature(
      secret,
      {
        id: req.headers.get('svix-id') ?? '',
        timestamp: req.headers.get('svix-timestamp') ?? '',
        signature: req.headers.get('svix-signature') ?? '',
      },
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

  // 2b. Only the transcript-ready event triggers generation. Recall also emits
  // earlier bot-status events (bot.done, etc.) that carry the same bot id but
  // fire BEFORE the transcript exists — enqueuing on those would race the
  // pipeline against a not-yet-ready transcript. Acknowledge (200) so Svix does
  // not retry, but do not enqueue. See RECALL_TRANSCRIPT_DONE_EVENT.
  if (!isTranscriptReadyEvent(event)) {
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

  // 4. Enqueue the generation job + mark the meeting processing, then 202.
  const jobId = await enqueueGenerate({ meetingId: meeting.id, botJobId });
  await db
    .from('meetings')
    .update({ pipeline_status: 'processing', pipeline_started_at: new Date().toISOString() })
    .eq('id', meeting.id);

  return NextResponse.json({ accepted: true, meetingId: meeting.id, jobId }, { status: 202 });
}
