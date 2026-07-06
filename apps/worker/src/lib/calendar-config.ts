/**
 * Operational tuning for the P4 calendar crons — kept in the worker (not the
 * shared queue contract) because these are internal scan/dispatch policies, not a
 * cross-package API. Queue names + intervals live in `@gracie/shared`.
 */

/** Timezone the "business hours" gate is evaluated in (docs/09 Phase 4 — ET). */
export const SCAN_TIMEZONE = 'America/New_York';

/** Business-hours window [start, end) in `SCAN_TIMEZONE`, Mon–Fri. */
export const BUSINESS_START_HOUR = 7;
export const BUSINESS_END_HOUR = 19;

/**
 * Scan window: look back a little (to catch just-started / in-progress meetings)
 * and ahead far enough to cover the calendar UI's forward display horizon
 * (~62 days). Reading the full displayed range is what lets reconciliation safely
 * remove cancelled/orphaned meetings: a meeting absent from a clean sweep of this
 * window is genuinely gone, not merely beyond what we bothered to read. (The bot
 * still dispatches off the ≤5-min lead window from the DB, independent of this.)
 */
export const SCAN_LOOKBACK_MINUTES = 120;
export const SCAN_LOOKAHEAD_DAYS = 62;

/** Dispatch a bot when a meeting starts within this many minutes (docs/07 §1). */
export const BOT_DISPATCH_LEAD_MINUTES = 5;

/**
 * Don't dispatch for a meeting that already started more than this many minutes
 * ago — the join window has passed and a late bot adds no value.
 */
export const BOT_DISPATCH_GRACE_MINUTES = 60;

/**
 * True when `date` falls on a weekday within business hours in `SCAN_TIMEZONE`.
 * Uses `Intl` parts so DST is handled correctly without a date library.
 */
export function isWithinBusinessHours(date: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCAN_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // `hour12: false` can render midnight as "24" — normalize to 0.
  const hour = Number(hourRaw) % 24;
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  return isWeekday && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}
