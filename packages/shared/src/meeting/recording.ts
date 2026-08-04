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

/** `t` seconds → `m:ss` (or `h:mm:ss` past an hour) for a transcript timestamp. */
export function formatClock(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
