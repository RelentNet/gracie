/**
 * Recall webhook verification tests.
 *
 * REGRESSION GUARD: Recall delivers Svix webhooks with the UNBRANDED headers
 * (`webhook-id` / `webhook-timestamp` / `webhook-signature`). The route
 * originally read only the branded `svix-*` names, so every real delivery
 * verified against three empty strings and was rejected 401 `invalid_signature`
 * before any HMAC was computed — silently blocking ALL automatic document
 * generation (no meeting ever produced docs except one manual recovery).
 *
 * Pure — no HTTP, no DB. Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  isRecordingDoneEvent,
  isTranscriptReadyEvent,
  parseRecallWebhook,
  readSvixHeaders,
  verifyRecallSignature,
} from './recall-webhook';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_3GdinQQR7D0fg8fuBtXt02H7YYZ';
const TIMESTAMP = '1784409020';

/** Sign a body exactly as Svix does: base64(HMAC-SHA256(secret, `id.ts.body`)). */
function sign(body: string, id = ID, timestamp = TIMESTAMP): string {
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

/** Build a header getter from a plain map (mirrors `req.headers.get`). */
function getter(headers: Record<string, string>): (name: string) => string | null {
  return (name) => headers[name.toLowerCase()] ?? null;
}

/** The real production payload shape Recall sent for the DHITS meeting. */
const REAL_PAYLOAD = JSON.stringify({
  event: 'transcript.done',
  data: {
    bot: { id: '06af5b4a-b72b-4f71-b9ca-798970870e26', metadata: {} },
    data: { code: 'done', sub_code: null, updated_at: '2026-07-17T17:06:52.324+00:00' },
    recording: { id: '7de7a57a-bb12-4c15-b45b-287b1f9ff5a4', metadata: {} },
    transcript: { id: 'f2a3b5e8-ecb2-41a4-9171-45438713fbe2', metadata: {} },
  },
});

test('REGRESSION: verifies a delivery carrying the UNBRANDED webhook-* headers (what Recall sends)', () => {
  const headers = getter({
    'webhook-id': ID,
    'webhook-timestamp': TIMESTAMP,
    'webhook-signature': sign(REAL_PAYLOAD),
  });
  assert.equal(
    verifyRecallSignature(SECRET, readSvixHeaders(headers), REAL_PAYLOAD),
    true,
    'a correctly-signed Recall delivery must verify — this is the bug that 401d every webhook',
  );
});

test('still verifies the BRANDED svix-* headers (back-compat)', () => {
  const headers = getter({
    'svix-id': ID,
    'svix-timestamp': TIMESTAMP,
    'svix-signature': sign(REAL_PAYLOAD),
  });
  assert.equal(verifyRecallSignature(SECRET, readSvixHeaders(headers), REAL_PAYLOAD), true);
});

test('branded headers win when both spellings are present', () => {
  const headers = getter({
    'svix-id': ID,
    'svix-timestamp': TIMESTAMP,
    'svix-signature': sign(REAL_PAYLOAD),
    'webhook-id': 'other',
    'webhook-timestamp': '123',
    'webhook-signature': 'v1,bogus',
  });
  assert.deepEqual(readSvixHeaders(headers), {
    id: ID,
    timestamp: TIMESTAMP,
    signature: sign(REAL_PAYLOAD),
  });
});

test('missing headers yield empty strings and fail closed (no HMAC computed)', () => {
  assert.deepEqual(readSvixHeaders(getter({})), { id: '', timestamp: '', signature: '' });
  assert.equal(verifyRecallSignature(SECRET, readSvixHeaders(getter({})), REAL_PAYLOAD), false);
});

test('a tampered body does NOT verify', () => {
  const headers = getter({
    'webhook-id': ID,
    'webhook-timestamp': TIMESTAMP,
    'webhook-signature': sign(REAL_PAYLOAD),
  });
  const tampered = REAL_PAYLOAD.replace('06af5b4a', 'deadbeef');
  assert.equal(verifyRecallSignature(SECRET, readSvixHeaders(headers), tampered), false);
});

test('a signature from the wrong secret does NOT verify', () => {
  const key = Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64');
  const bogus = `v1,${createHmac('sha256', key).update(`${ID}.${TIMESTAMP}.${REAL_PAYLOAD}`).digest('base64')}`;
  const headers = getter({
    'webhook-id': ID,
    'webhook-timestamp': TIMESTAMP,
    'webhook-signature': bogus,
  });
  assert.equal(verifyRecallSignature(SECRET, readSvixHeaders(headers), REAL_PAYLOAD), false);
});

test('parses the real payload: transcript.done + bot id', () => {
  const parsed = parseRecallWebhook(JSON.parse(REAL_PAYLOAD));
  assert.equal(parsed.event, 'transcript.done');
  assert.equal(parsed.botJobId, '06af5b4a-b72b-4f71-b9ca-798970870e26');
  assert.equal(isTranscriptReadyEvent(parsed.event), true);
  assert.equal(isRecordingDoneEvent(parsed.event), false);
});

test('recording.done is recognized and carries the bot id (same media-event envelope)', () => {
  const parsed = parseRecallWebhook({
    event: 'recording.done',
    data: { recording: { id: 'rec_1' }, bot: { id: 'bot_1' } },
  });
  assert.equal(isRecordingDoneEvent(parsed.event), true);
  assert.equal(isTranscriptReadyEvent(parsed.event), false);
  assert.equal(parsed.botJobId, 'bot_1');
});
