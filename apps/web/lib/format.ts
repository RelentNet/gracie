/**
 * Formatting helpers.
 *
 * Timestamps render in the VIEWER's timezone (`formatDateTime`/`formatDate`
 * pass no `timeZone`, so Intl uses the device's). Every caller is a client
 * component that renders after a client-side fetch, so the device timezone is
 * always the user's — never the server's. The `formatEastern*` variants pin
 * Eastern for ET-anchored business artifacts (the daily sync mirrors the
 * 6:00 AM ET email) and for SERVER components, where the runtime timezone is
 * the container's (UTC), not the viewer's.
 */

const EASTERN_TIME_ZONE = 'America/New_York';

/** Format an ISO timestamp as a date+time string in the viewer's timezone. CLIENT components only. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Format an ISO date/timestamp as a date string in the viewer's timezone. CLIENT components only. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
  }).format(date);
}

/** Format an ISO timestamp as an Eastern-time date+time string (ET-anchored artifacts / server components). */
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

/** Format an ISO date/timestamp as an Eastern-time date string (ET-anchored artifacts / server components). */
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

/** Today's date, long form, Eastern time — used in server-rendered page headers. */
export function todayEastern(): string {
  return formatEasternDate(new Date().toISOString());
}
