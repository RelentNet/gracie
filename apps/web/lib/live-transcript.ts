/**
 * Worker↔browser bridge for the live meeting transcript (Phase D). Server-only.
 *
 * The ingest webhook PUBLISHES each realtime utterance to a per-meeting Redis
 * channel (and a short-TTL buffer for late joiners); the SSE endpoint SUBSCRIBES to
 * that channel and forwards utterances to the browser. Redis is the app's only
 * cross-process broker (same instance BullMQ uses) — utterances never touch
 * permanent storage (the async transcript, Phase C, is the canonical record).
 *
 * Channel/buffer keys + the buffer bounds live in `@gracie/shared` so both ends
 * agree; only the ioredis wiring lives here. Mirrors `lib/queue.ts`'s lazy shared
 * connection + `maxRetriesPerRequest: null` (required by ioredis blocking ops).
 */
import 'server-only';

import { Redis } from 'ioredis';

import {
  LIVE_TRANSCRIPT_BUFFER_MAX,
  LIVE_TRANSCRIPT_BUFFER_TTL_S,
  liveTranscriptBufferKey,
  liveTranscriptChannel,
  type TranscriptSegment,
} from '@gracie/shared';

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') {
    throw new Error('REDIS_URL is not set — required for the live transcript bridge.');
  }
  return url;
}

// One shared publisher connection per server process (publish + buffer writes/reads).
// A connection in ioredis subscriber mode can't issue these, so the SSE endpoint
// gets its OWN connection via createLiveSubscriber() below.
let publisher: Redis | undefined;
function getPublisher(): Redis {
  if (publisher !== undefined) return publisher;
  publisher = new Redis(redisUrl(), { maxRetriesPerRequest: null });
  return publisher;
}

/**
 * Publish one utterance to a meeting's live channel AND append it to the capped,
 * self-expiring buffer so a viewer who opens the page mid-call still sees recent
 * context. Buffer maintenance is one pipelined round-trip.
 */
export async function publishLiveUtterance(meetingId: string, utterance: TranscriptSegment): Promise<void> {
  const redis = getPublisher();
  const message = JSON.stringify(utterance);
  const bufKey = liveTranscriptBufferKey(meetingId);
  await Promise.all([
    redis.publish(liveTranscriptChannel(meetingId), message),
    redis
      .multi()
      .rpush(bufKey, message)
      .ltrim(bufKey, -LIVE_TRANSCRIPT_BUFFER_MAX, -1)
      .expire(bufKey, LIVE_TRANSCRIPT_BUFFER_TTL_S)
      .exec(),
  ]);
}

/** Recent buffered utterances (already-serialized JSON strings) for a late joiner. */
export async function readBufferedUtterances(meetingId: string): Promise<string[]> {
  return getPublisher().lrange(liveTranscriptBufferKey(meetingId), 0, -1);
}

/** A DEDICATED connection for one SSE subscription (subscriber mode is exclusive). */
export function createLiveSubscriber(): Redis {
  return new Redis(redisUrl(), { maxRetriesPerRequest: null });
}

/**
 * Atomic "first-caller-wins" claim with a TTL, reusing the shared publisher
 * connection. `SET key 1 EX ttl NX` returns 'OK' only for the first caller within
 * the window; later callers get null. Used to DEBOUNCE voice commands — the STT
 * emits the same utterance several times in a row, so overlapping/duplicate
 * detections collapse to one action per meeting+command within the window. Distributed
 * (cross-process), so two web replicas can't both fire. Best-effort by the caller.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const res = await getPublisher().set(key, '1', 'EX', ttlSeconds, 'NX');
  return res === 'OK';
}
