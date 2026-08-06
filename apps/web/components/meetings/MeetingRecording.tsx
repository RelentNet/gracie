'use client';

import { useEffect, useRef, useState } from 'react';
import {
  activeSegmentIndex,
  formatClock,
  groupStillsBySegment,
  type TranscriptSegment,
} from '@gracie/shared';

import { TYPE } from '@/lib/typography';

/**
 * MeetingRecording — the recorded-meeting player (meeting page ended-state). When a
 * video is available an HTML5 `<video>` streams the mixed recording DIRECTLY from
 * Recall's S3 (a fresh signed URL resolved server-side per view — never stored, never
 * proxied; S3 honors Range so native seeking works), with the timestamped transcript
 * beside it:
 *   - click a line  → `video.currentTime = segment.start` and play,
 *   - as it plays   → the active line highlights + scrolls into view (`timeupdate`).
 *
 * SCREEN-SHARE STILLS are pinned inline in the transcript at the moment they appeared
 * (the line closest at/before each still's timestamp), and click-to-enlarge. Stills are
 * kept forever, so after the 6-month video expires the transcript + stills remain the
 * PERMANENT visual record — the whole point of the feature.
 *
 * EXPIRY is detected two ways and degrades to the same transcript-only layout with an
 * "expired" notice: server-side (no URL from Recall → `videoUrl === null`), and
 * client-side (`videoUrl` was a fresh signed URL but 404s in the browser once retention
 * lapsed — the server can't know without downloading, so the `<video>` `onError` handles it).
 */
export interface RecordingStill {
  readonly tsSeconds: number;
  /** Same-origin `/api/files/raw` URL (re-authorized per fetch). */
  readonly src: string;
}

export interface MeetingRecordingProps {
  /** Fresh mixed-video URL, or null once the recording has expired (stills survive). */
  readonly videoUrl: string | null;
  readonly segments: readonly TranscriptSegment[] | null;
  readonly stills?: readonly RecordingStill[];
}

/** A row of still thumbnails; clicking one enlarges it. */
function StillStrip({
  stills,
  onOpen,
}: {
  readonly stills: readonly RecordingStill[];
  readonly onOpen: (still: RecordingStill) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2 p-2">
      {stills.map((still, i) => (
        <button
          key={`${still.tsSeconds}-${i}`}
          type="button"
          onClick={(): void => onOpen(still)}
          className="overflow-hidden rounded-md border"
          style={{ borderColor: 'var(--border-subtle)', cursor: 'zoom-in' }}
          title={`Shared screen at ${formatClock(still.tsSeconds)} — click to enlarge`}
        >
          {/* Stills are kilobytes, so the thumbnail IS the full image, just sized down. */}
          <img
            src={still.src}
            alt={`Shared screen at ${formatClock(still.tsSeconds)}`}
            loading="lazy"
            className="block h-24 w-auto max-w-[16rem] object-contain"
            style={{ background: 'var(--surface-muted, #000)' }}
          />
        </button>
      ))}
    </div>
  );
}

export function MeetingRecording({
  videoUrl,
  segments,
  stills = [],
}: MeetingRecordingProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [enlarged, setEnlarged] = useState<RecordingStill | null>(null);
  // The video URL is a fresh Recall signed URL resolved server-side, but a recording
  // whose 6-month retention has lapsed 404s when the browser actually fetches it — the
  // server can't know that without downloading. Treat a load error the same as no video:
  // fall back to the transcript + stills (which are kept permanently) instead of showing
  // a broken <video>.
  const [videoFailed, setVideoFailed] = useState(false);
  const videoAvailable = videoUrl !== null && !videoFailed;

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

  const openStill = (still: RecordingStill): void => {
    setEnlarged(still);
    dialogRef.current?.showModal();
  };
  const closeStill = (): void => {
    dialogRef.current?.close();
  };

  const hasTranscript = segments !== null && segments.length > 0;
  const placed = groupStillsBySegment(segments ?? [], stills);

  // Shown once the video is gone (retention lapsed or its URL 404'd) but the permanent
  // record — transcript and/or screen-share stills — is still here.
  const expiredNotice =
    !videoAvailable && (hasTranscript || stills.length > 0) ? (
      <p
        className="rounded-lg border p-3"
        style={{
          ...TYPE.secondary,
          color: 'var(--text-secondary)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        This recording has expired — the transcript and screen-share stills remain.
      </p>
    ) : null;

  const transcriptPanel = (
    <div className="relative min-h-0">
      <div
        className="flex max-h-[60vh] min-h-[12rem] flex-col overflow-hidden rounded-lg border lg:absolute lg:inset-0 lg:max-h-none lg:min-h-0"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="border-b p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <span style={TYPE.label}>Transcript</span>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {/* Stills before the first timed line (or when the transcript has no timing). */}
          {placed.leading.length > 0 ? (
            <StillStrip stills={placed.leading} onOpen={openStill} />
          ) : null}
          {!hasTranscript ? (
            placed.leading.length === 0 ? (
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }} className="p-2">
                No transcript is available for this recording.
              </p>
            ) : null
          ) : (
            <ol>
              {segments.map((segment, i) => {
                const isActive = i === activeIndex;
                const seekable = videoAvailable && segment.start !== null;
                const pinned = placed.bySegment.get(i);
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
                        style={{
                          ...TYPE.label,
                          color: 'var(--color-blue-600)',
                          textTransform: 'none',
                        }}
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
                    {pinned !== undefined ? <StillStrip stills={pinned} onOpen={openStill} /> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {videoAvailable ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            controls
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onError={(): void => setVideoFailed(true)}
            className="w-full rounded-lg border"
            style={{ borderColor: 'var(--border-subtle)', background: '#000', maxHeight: '70vh' }}
          >
            <track kind="captions" />
          </video>
          {/* On lg the video (a replaced element) sets the row height; this cell stretches
              to it. The inner panel is absolutely positioned so its long transcript can't
              grow the row. Stacked, it flows normally with a max-height. Both scroll. */}
          {transcriptPanel}
        </div>
      ) : (
        // Video expired / 404'd — stills + transcript stay as the permanent record, full width.
        <div className="flex flex-col gap-4">
          {expiredNotice}
          {transcriptPanel}
        </div>
      )}

      {/* Click-to-enlarge lightbox. Native <dialog> gives Esc-to-close + focus trap;
          clicking anywhere (backdrop or image) dismisses it. */}
      <dialog
        ref={dialogRef}
        onClose={(): void => setEnlarged(null)}
        onClick={closeStill}
        className="m-auto max-h-[90vh] max-w-[90vw] rounded-lg border p-0 backdrop:bg-black/70"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {enlarged !== null ? (
          <img
            src={enlarged.src}
            alt={`Shared screen at ${formatClock(enlarged.tsSeconds)}`}
            className="block max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : null}
      </dialog>
    </>
  );
}
