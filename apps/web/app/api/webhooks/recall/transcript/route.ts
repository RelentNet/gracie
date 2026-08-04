/**
 * POST /api/webhooks/recall/transcript?meetingId=… — Recall.ai realtime transcript
 * ingest (meeting page Phase D). Recall PUSHES `transcript.data` utterances here
 * (configured per-bot at dispatch via `recording_config.realtime_endpoints`), each
 * signed with the workspace verification secret exactly like the lifecycle webhook.
 *
 * Flow: verify the signature (SAME Svix scheme as `/api/webhooks/recall`) → read
 * the `meetingId` from the query (we set the URL at dispatch, so it's trusted once
 * the signature proves the request is Recall's) → parse the utterance → PUBLISH it
 * to the meeting's Redis channel, which the SSE endpoint forwards to the browser.
 *
 * Utterances are transient: published to Redis (pub/sub + a short-TTL buffer),
 * never permanent storage — the async transcript (Phase C) is the canonical record.
 * A separate route from the lifecycle webhook so this hot, per-utterance path never
 * touches the DB and the meeting id comes from the URL (no bot→meeting lookup).
 *
 * DEPLOY FOLLOW-UP: like the lifecycle webhook, verification is SKIPPED with a
 * warning until `RECALL_WEBHOOK_SECRET` is provisioned. NPM must also honor
 * `proxy_buffering off` for the SSE side; this route only publishes.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { parseRealtimeTranscript } from '@gracie/shared/recall';

import { publishLiveUtterance } from '@/lib/live-transcript';
import { readSvixHeaders, verifyRecallSignature } from '@/lib/recall-webhook';

// ioredis + node:crypto are Node-only — force the Node.js runtime.
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
    const ok = verifyRecallSignature(secret, readSvixHeaders((name) => req.headers.get(name)), body);
    if (!ok) return reject(401, 'invalid_signature', 'Webhook signature verification failed');
  } else {
    console.warn(
      '[webhooks/recall/transcript] RECALL_WEBHOOK_SECRET unset — skipping signature verification (deploy follow-up)',
    );
  }

  // 2. Which meeting this stream belongs to (set by us in the dispatch-time URL).
  const meetingId = new URL(req.url).searchParams.get('meetingId');
  if (meetingId === null || meetingId === '') {
    return reject(400, 'missing_meeting', 'meetingId query param is required');
  }

  // 3. Parse the utterance; ignore non-utterance/empty events (still ack so Recall
  // doesn't retry).
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return reject(400, 'bad_request', 'Body is not valid JSON');
  }
  const utterance = parseRealtimeTranscript(payload);
  if (utterance === null) {
    return NextResponse.json({ accepted: true, ignored: true }, { status: 200 });
  }

  // 4. Relay to any live viewer via Redis pub/sub. Best-effort: live transcript is
  // ephemeral, so a Redis blip drops this line rather than failing the request
  // (a 500 could make Recall back off/disable the endpoint; the async transcript
  // remains the canonical record regardless).
  try {
    await publishLiveUtterance(meetingId, utterance);
  } catch (error) {
    console.error('[webhooks/recall/transcript] publish failed', error);
    return NextResponse.json({ accepted: true, published: false }, { status: 200 });
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
