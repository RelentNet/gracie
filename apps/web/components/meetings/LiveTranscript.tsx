'use client';

import { useEffect, useRef, useState } from 'react';
import { formatClock, type TranscriptSegment } from '@gracie/shared';

import { TYPE } from '@/lib/typography';

/**
 * LiveTranscript — the streaming transcript for a meeting in session (meeting page
 * Phase D). Opens an SSE connection to `/api/meetings/[id]/live-transcript` and
 * appends each utterance Otter-style (speaker + text, autoscrolled). `EventSource`
 * reconnects on its own; utterances are live-only (the recorded transcript from
 * Phase C is the canonical record once the meeting ends).
 */
export interface LiveTranscriptProps {
  readonly meetingId: string;
}

export function LiveTranscript({ meetingId }: LiveTranscriptProps): React.JSX.Element {
  const [lines, setLines] = useState<readonly TranscriptSegment[]>([]);
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/meetings/${meetingId}/live-transcript`);
    source.onopen = (): void => setConnected(true);
    source.onmessage = (event): void => {
      try {
        const seg = JSON.parse(event.data) as TranscriptSegment;
        if (typeof seg?.text === 'string' && seg.text !== '') {
          setLines((prev) => [...prev, seg]);
        }
      } catch {
        // Ignore a malformed frame rather than tearing down the stream.
      }
    };
    // EventSource auto-reconnects on error; reflect the gap in the UI meanwhile.
    source.onerror = (): void => setConnected(false);
    return (): void => source.close();
  }, [meetingId]);

  // Keep the newest line in view as utterances arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length]);

  return (
    <div
      className="mt-3 flex max-h-[50vh] min-h-[8rem] flex-col overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div
        className="flex items-center justify-between border-b p-2"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <span style={TYPE.label}>Live transcript</span>
        {!connected ? (
          <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Connecting…</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {lines.length === 0 ? (
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }} className="p-2">
            Waiting for people to start talking. Lines appear here as they’re spoken.
          </p>
        ) : (
          <ol>
            {lines.map((seg, i) => (
              <li key={i} className="flex gap-2 p-1">
                {seg.start !== null ? (
                  <span
                    className="shrink-0 font-data tabular-nums"
                    style={{ ...TYPE.label, color: 'var(--color-blue-600)', textTransform: 'none' }}
                  >
                    {formatClock(seg.start)}
                  </span>
                ) : null}
                <span className="min-w-0">
                  {seg.speaker !== '' ? <span style={TYPE.bodyStrong}>{seg.speaker}: </span> : null}
                  <span style={TYPE.body}>{seg.text}</span>
                </span>
              </li>
            ))}
            <div ref={endRef} />
          </ol>
        )}
      </div>
    </div>
  );
}
