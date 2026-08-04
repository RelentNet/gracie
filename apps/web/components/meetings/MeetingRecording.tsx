'use client';

import { useEffect, useRef, useState } from 'react';
import { activeSegmentIndex, formatClock, type TranscriptSegment } from '@gracie/shared';

import { TYPE } from '@/lib/typography';

/**
 * MeetingRecording — the recorded-meeting player (meeting page ended-state). An HTML5
 * `<video>` streams the mixed recording DIRECTLY from Recall's S3 (a fresh signed URL
 * resolved server-side per view — never stored on our infra, never proxied; S3 honors
 * Range so native seeking works), with the timestamped transcript beside it:
 *   - click a line  → `video.currentTime = segment.start` and play,
 *   - as it plays   → the active line highlights + scrolls into view (`timeupdate`).
 *
 * The transcript `segments` are resolved server-side (our durable MinIO copy, or a
 * live-pull-and-cache for back-catalog meetings) and passed in directly — the readable
 * transcript also lands as a downloadable document in the meeting's folder. `null`/empty
 * segments render a plain "no transcript" note so a video-only recording still plays.
 */
export interface MeetingRecordingProps {
  readonly videoUrl: string;
  readonly segments: readonly TranscriptSegment[] | null;
}

export function MeetingRecording({ videoUrl, segments }: MeetingRecordingProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Keep the active line in view as playback moves it.
  useEffect(() => {
    if (activeIndex < 0 || listRef.current === null) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-seg="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const onTimeUpdate = (): void => {
    if (segments === null || segments.length === 0) return;
    const next = activeSegmentIndex(segments, videoRef.current?.currentTime ?? 0);
    setActiveIndex((prev) => (prev === next ? prev : next));
  };

  const seekTo = (segment: TranscriptSegment): void => {
    const video = videoRef.current;
    if (video === null || segment.start === null) return;
    video.currentTime = segment.start;
    void video.play();
  };

  const hasTranscript = segments !== null && segments.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <video
        ref={videoRef}
        src={videoUrl}
        controls
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        className="w-full rounded-lg border"
        style={{ borderColor: 'var(--border-subtle)', background: '#000', maxHeight: '70vh' }}
      >
        <track kind="captions" />
      </video>

      <div
        className="flex max-h-[70vh] min-h-[12rem] flex-col overflow-hidden rounded-lg border"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="border-b p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <span style={TYPE.label}>Transcript</span>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {!hasTranscript ? (
            <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }} className="p-2">
              No transcript is available for this recording.
            </p>
          ) : (
            <ol>
              {segments.map((segment, i) => {
                const isActive = i === activeIndex;
                const seekable = segment.start !== null;
                return (
                  <li key={i} data-seg={i}>
                    <button
                      type="button"
                      onClick={(): void => seekTo(segment)}
                      disabled={!seekable}
                      aria-current={isActive ? 'true' : undefined}
                      className="flex w-full gap-2 rounded-md p-2 text-left"
                      style={{
                        cursor: seekable ? 'pointer' : 'default',
                        background: isActive ? 'var(--color-blue-100)' : 'transparent',
                      }}
                    >
                      <span
                        className="shrink-0 font-data tabular-nums"
                        style={{ ...TYPE.label, color: 'var(--color-blue-600)', textTransform: 'none' }}
                      >
                        {segment.start !== null ? formatClock(segment.start) : '—'}
                      </span>
                      <span className="min-w-0">
                        {segment.speaker !== '' ? (
                          <span style={TYPE.bodyStrong}>{segment.speaker}: </span>
                        ) : null}
                        <span style={TYPE.body}>{segment.text}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
