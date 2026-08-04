/**
 * Live-transcript bridge contracts (meeting page Phase D). Pure, dependency-free
 * derivations shared by BOTH ends of the worker↔browser relay so they can never
 * disagree on a channel name or frame shape:
 *   - the ingest webhook (`/api/webhooks/recall/transcript`) PUBLISHES each
 *     realtime utterance to the per-meeting Redis channel + a short-TTL buffer;
 *   - the SSE endpoint (`/api/meetings/[id]/live-transcript`) SUBSCRIBES to that
 *     same channel and forwards each utterance as an SSE `data:` frame.
 *
 * Utterances are transient: they live only in Redis (pub/sub + a capped buffer for
 * late joiners), never permanent storage — the async transcript (Phase C) is the
 * canonical record. The ioredis wiring lives in `apps/web/lib/live-transcript.ts`;
 * only the strings/shapes live here (kept client-safe + node:test-runnable).
 */

/**
 * Ingest-webhook URL a dispatched bot streams its realtime transcript to (Phase D),
 * with the meeting id in the query so the stateless ingest handler knows which Redis
 * channel to publish to without a DB lookup. Shared by BOTH dispatch paths (the
 * worker cron and the web on-demand "Join now") so the URL shape never diverges.
 */
export function buildRealtimeTranscriptUrl(appBaseUrl: string, meetingId: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/api/webhooks/recall/transcript?meetingId=${encodeURIComponent(meetingId)}`;
}

/** Redis pub/sub channel a meeting's live utterances flow through. */
export function liveTranscriptChannel(meetingId: string): string {
  return `live-transcript:${meetingId}`;
}

/** Redis list key buffering a meeting's most-recent utterances for late joiners. */
export function liveTranscriptBufferKey(meetingId: string): string {
  return `live-transcript:buf:${meetingId}`;
}

/**
 * Most-recent utterances kept per meeting so a viewer opening the page mid-call
 * sees context instead of a blank pane. Capped (not the whole meeting) — the full
 * record is the async transcript.
 */
export const LIVE_TRANSCRIPT_BUFFER_MAX = 100;

/** TTL (seconds) on the buffer list — long enough to outlast a meeting, then self-clears. */
export const LIVE_TRANSCRIPT_BUFFER_TTL_S = 4 * 60 * 60;

/**
 * Wrap an already-serialized JSON payload as a single SSE `data:` frame. Takes the
 * exact string that was published so the relay re-frames rather than re-serializes
 * (one JSON encoding, done at publish). Pure; unit-tested.
 */
export function formatSseData(json: string): string {
  return `data: ${json}\n\n`;
}
