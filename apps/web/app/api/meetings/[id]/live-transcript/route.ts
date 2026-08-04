/**
 * GET /api/meetings/[id]/live-transcript — Server-Sent Events stream of a meeting's
 * live transcript (meeting page Phase D). Subscribes to the meeting's Redis channel
 * (fed by the realtime ingest webhook) and forwards each utterance as an SSE `data:`
 * frame, after replaying the recent buffer so a late joiner sees context.
 *
 * ACCESS CONTROL: gated BEFORE the stream opens. `getRequestUser()` 401s an
 * unauthenticated request; a missing meeting 404s. Beyond that, GA's access model
 * is "all staff see all clients" (operator-confirmed intended) — there is no
 * per-client ACL, and the in-session meeting page renders to any authenticated
 * staffer, so the live stream matches that exact gate. A live utterance has no
 * stored key, so `canAccessKey` (which gates the recorded video/transcript by
 * storage key) does not apply here; if a restricted-key model is later added for
 * meetings, gate here the same way the page does.
 *
 * SSE headers set `X-Accel-Buffering: no`; the public edge (NPM) must also honor
 * `proxy_buffering off` for chunks to flush live (a tracked deploy follow-up).
 */
import type { NextRequest } from 'next/server';

import { formatSseData, liveTranscriptChannel } from '@gracie/shared';

import { getMeetingById } from '@/lib/data/meeting-occurrence';
import { getRequestUser } from '@/lib/api-auth';
import { createLiveSubscriber, readBufferedUtterances } from '@/lib/live-transcript';

// ioredis is Node-only, and the stream must not be statically optimized.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Ask any reverse proxy not to buffer — chunks must flush as they arrive.
  'X-Accel-Buffering': 'no',
} as const;

/** Keepalive comment so idle proxies/clients don't drop a quiet-meeting stream. */
const HEARTBEAT_MS = 15_000;

export async function GET(
  req: NextRequest,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // Gate BEFORE opening the stream.
  try {
    await getRequestUser();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
  const meeting = await getMeetingById(id);
  if (meeting === null) {
    return new Response('Not found', { status: 404 });
  }

  const channel = liveTranscriptChannel(id);
  const encoder = new TextEncoder();
  const subscriber = createLiveSubscriber();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  // EventSource auto-reconnects and replays `Last-Event-ID`; when it's present the
  // client already has the backlog, so skip the buffer replay to avoid duplicate
  // lines. Each data frame carries an id purely so the browser sets that header
  // (the value is a per-connection counter — used only as a "reconnect?" flag).
  const isReconnect = req.headers.get('last-event-id') !== null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      let eventId = 0;
      const send = (frame: string): void => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Controller closed (client gone) — the abort handler cleans up.
        }
      };
      const sendUtterance = (message: string): void => {
        eventId += 1;
        send(`id: ${eventId}\n${formatSseData(message)}`);
      };

      // Replay recent context for a first-time late joiner (best-effort).
      if (!isReconnect) {
        try {
          for (const message of await readBufferedUtterances(id)) sendUtterance(message);
        } catch {
          // Buffer read is optional — an empty/failed buffer just means no backlog.
        }
      }
      send(': connected\n\n');

      subscriber.on('message', (_ch, message) => sendUtterance(message));
      await subscriber.subscribe(channel);

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      const close = (): void => {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        void subscriber.quit().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      req.signal.addEventListener('abort', close);
    },
    cancel(): void {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      void subscriber.quit().catch(() => undefined);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
