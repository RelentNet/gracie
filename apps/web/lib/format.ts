/**
 * Formatting helpers. All timestamps render in Eastern time (docs/08 §1).
 */

const EASTERN_TIME_ZONE = 'America/New_York';

/** Format an ISO timestamp as an Eastern-time date+time string. */
export function formatEasternDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Format an ISO date/timestamp as an Eastern-time date string. */
export function formatEasternDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    dateStyle: 'long',
  }).format(date);
}

/** Today's date, long form, Eastern time — used in page headers. */
export function todayEastern(): string {
  return formatEasternDate(new Date().toISOString());
}
