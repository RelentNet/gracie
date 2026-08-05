/**
 * Formatting helpers — timezone policy.
 *
 * Canonical timestamps are always stored UTC/ISO; these helpers only pick the
 * WALL CLOCK a value is DISPLAYED in:
 *
 *   • CLIENT (browser), no explicit zone → the device's local zone. This is the
 *     app-wide default — "App UI → device-local" (the operator decision). Client
 *     components keep calling these with no zone argument.
 *   • SERVER (SSR), no explicit zone → `DEFAULT_TIME_ZONE` (America/New_York),
 *     the profile fallback — SSR can't read the device. A server component that
 *     knows the viewer's profile timezone passes it as `zone` (the user's
 *     `timezone`, itself falling back to America/New_York when unset), so the
 *     server HTML renders in the viewer's zone.
 *   • Any caller may pass an explicit IANA `zone` to override.
 *
 * The `formatEastern*` names are kept (no repo-wide rename) but no longer pin
 * Eastern unconditionally — Eastern is now only the SSR/profile fallback.
 */

/** The profile-timezone / SSR fallback used when no zone is known. */
export const DEFAULT_TIME_ZONE = 'America/New_York';

/**
 * The effective IANA zone to format in:
 *   - a non-empty explicit `zone` always wins;
 *   - else, on the client, `undefined` so Intl uses the device's local zone;
 *   - else (server / no `window`), the profile/SSR fallback `DEFAULT_TIME_ZONE`.
 * Exported for direct unit testing of the resolution rule.
 */
export function resolveTimeZone(zone?: string | null): string | undefined {
  if (typeof zone === 'string' && zone !== '') return zone;
  return typeof window === 'undefined' ? DEFAULT_TIME_ZONE : undefined;
}

function formatIso(
  iso: string,
  zone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: resolveTimeZone(zone), ...options }).format(date);
}

/** Date + time (e.g. "Jul 10, 2026, 9:00 AM"). Device-local on the client; pass the profile zone in server components. */
export function formatDateTime(iso: string, zone?: string | null): string {
  return formatIso(iso, zone, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Long date (e.g. "July 10, 2026"). Device-local on the client; pass the profile zone in server components. */
export function formatDate(iso: string, zone?: string | null): string {
  return formatIso(iso, zone, { dateStyle: 'long' });
}

/** Back-compat name (server components / ET-anchored artifacts). Identical to {@link formatDateTime}. */
export const formatEasternDateTime = formatDateTime;

/** Back-compat name (server components / ET-anchored artifacts). Identical to {@link formatDate}. */
export const formatEasternDate = formatDate;

/** Today's date, long form, in `zone` (server page headers pass the profile zone; falls back to Eastern on the server). */
export function todayEastern(zone?: string | null): string {
  return formatDate(new Date().toISOString(), zone);
}
