/**
 * Calendar date + month-grid helpers (docs/08 §M7). Extracted verbatim from the
 * calendar page. All times render in the VIEWER's timezone — this page renders
 * only after a client-side fetch, so the device is always the user's, never the
 * server.
 */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Viewer-local calendar-day key (YYYY-MM-DD) for an ISO instant. */
export function localDayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Viewer-local time-of-day (e.g. "2:00 PM") for an ISO instant. */
export function localTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Long viewer-local date label (e.g. "Monday, July 6, 2026") for a day key. */
export function localDayLabel(dayKey: string): string {
  // Anchor at 16:00 UTC so the calendar day is unambiguous for any US timezone.
  const [y, m, d] = dayKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 16));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(anchor);
}

export interface GridCell {
  readonly key: string;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

/** Build the 6×7 month grid (viewer-local day keys) for the given year/month (0-based). */
export function buildMonthGrid(
  year: number,
  month: number,
): { cells: GridCell[]; fromIso: string; toIso: string } {
  const todayKey = localDayKey(new Date().toISOString());
  const firstAnchor = new Date(Date.UTC(year, month, 1, 16));
  const firstWeekday = firstAnchor.getUTCDay(); // 0=Sun
  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const anchor = new Date(Date.UTC(year, month, 1 - firstWeekday + i, 16));
    const key = localDayKey(anchor.toISOString());
    const [, mm, dd] = key.split('-').map(Number);
    cells.push({
      key,
      dayOfMonth: dd ?? 1,
      inMonth: (mm ?? 1) - 1 === month,
      isToday: key === todayKey,
    });
  }
  // Query window spans the visible grid (full days), a little padded.
  const fromIso = new Date(Date.UTC(year, month, 1 - firstWeekday, 0)).toISOString();
  const toIso = new Date(Date.UTC(year, month, 1 - firstWeekday + 42, 0)).toISOString();
  return { cells, fromIso, toIso };
}
