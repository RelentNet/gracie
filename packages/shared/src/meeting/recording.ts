/**
 * Pure helpers for the recorded-meeting player (meeting page Phase C). Kept out of
 * the `'use client'` component so the seek/highlight logic is unit-testable in the
 * worker's node:test runner (the web app has none).
 */
import type { TranscriptSegment } from '../types/meeting.js';

/**
 * Index of the transcript segment playing at time `t` (seconds): the LAST segment
 * whose `start` is at/behind `t`. Returns -1 before the first timed segment (or
 * when none carry timestamps). Segments are assumed time-ordered, so the scan can
 * stop once a start overtakes `t`. Drives the active-line highlight on `timeupdate`.
 */
export function activeSegmentIndex(segments: readonly TranscriptSegment[], t: number): number {
  let active = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const start = segments[i]?.start;
    if (typeof start !== 'number') continue;
    if (start <= t) active = i;
    else break;
  }
  return active;
}

/** A screen-share still to pin in the transcript — `tsSeconds` from recording start. */
export interface TranscriptStill {
  readonly tsSeconds: number;
}

/** Stills grouped for inline rendering: those before the first timed line, then per-segment. */
export interface PlacedStills<T extends TranscriptStill> {
  /** Stills that fall before the first timestamped segment (rendered above the transcript). */
  readonly leading: readonly T[];
  /** segment index → stills that appeared at/after that line but before the next. */
  readonly bySegment: ReadonlyMap<number, readonly T[]>;
}

/**
 * Pin each still to the transcript line closest at/before its timestamp — the LAST
 * segment whose `start` is ≤ the still's `tsSeconds` (reuses {@link activeSegmentIndex}).
 * A still before the first timed line (or when NO segment carries a timestamp) lands in
 * `leading`, so it still renders. Stills are sorted by time within each bucket. Pure;
 * unit-tested. Generic so the web layer can attach its own fields (e.g. an image `src`).
 */
export function groupStillsBySegment<T extends TranscriptStill>(
  segments: readonly TranscriptSegment[],
  stills: readonly T[],
): PlacedStills<T> {
  const leading: T[] = [];
  const bySegment = new Map<number, T[]>();
  for (const still of [...stills].sort((a, b) => a.tsSeconds - b.tsSeconds)) {
    const idx = activeSegmentIndex(segments, still.tsSeconds);
    if (idx < 0) {
      leading.push(still);
    } else {
      const bucket = bySegment.get(idx);
      if (bucket === undefined) bySegment.set(idx, [still]);
      else bucket.push(still);
    }
  }
  return { leading, bySegment };
}

/** `t` seconds → `m:ss` (or `h:mm:ss` past an hour) for a transcript timestamp. */
export function formatClock(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
