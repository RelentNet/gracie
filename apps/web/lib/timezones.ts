/**
 * Timezone helpers shared by the self-service "Your timezone" control and the
 * profile-timezone API route. Pure + client-safe.
 */

/** True when `tz` is a non-empty string that Intl accepts as an IANA zone id. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    // Intl throws a RangeError for an unknown zone; a valid id constructs cleanly.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface TimeZoneOption {
  readonly id: string;
  readonly label: string;
}

/**
 * A short, curated dropdown of common zones (US first, then a spread of
 * international ones for travelers). Not exhaustive — the control also injects the
 * user's current + browser-detected zones so any valid IANA id stays selectable.
 */
export const COMMON_TIME_ZONES: readonly TimeZoneOption[] = [
  { id: 'America/New_York', label: 'Eastern (New York)' },
  { id: 'America/Chicago', label: 'Central (Chicago)' },
  { id: 'America/Denver', label: 'Mountain (Denver)' },
  { id: 'America/Phoenix', label: 'Mountain — no DST (Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { id: 'America/Sao_Paulo', label: 'Brazil (São Paulo)' },
  { id: 'Europe/London', label: 'UK (London)' },
  { id: 'Europe/Paris', label: 'Central Europe (Paris)' },
  { id: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  { id: 'Asia/Kolkata', label: 'India (Kolkata)' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
  { id: 'Australia/Sydney', label: 'Australia East (Sydney)' },
];
