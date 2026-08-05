'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { COMMON_TIME_ZONES } from '@/lib/timezones';

/**
 * Self-service "Your timezone" control (any role). Loads the user's profile zone,
 * renders a dropdown of common IANA zones, and PATCHes `/api/profile/timezone` on
 * change. The app UI itself renders in the device's local zone; this profile zone
 * is the server-side fallback that timezones the daily-sync email (and SSR).
 *
 * The current value and the browser-detected zone are always injected into the
 * list so any valid IANA id stays selectable even when it's not in the curated set.
 */
export function TimezoneSetting(): React.JSX.Element {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const browserZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiClient
      .get<{ timezone: string | null }>('/api/profile/timezone')
      .then((d) => {
        if (active) {
          setTimezone(d.timezone);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return (): void => {
      active = false;
    };
  }, []);

  const options = useMemo(() => {
    const map = new Map(COMMON_TIME_ZONES.map((z) => [z.id, z.label] as const));
    for (const extra of [browserZone, timezone]) {
      if (typeof extra === 'string' && extra !== '' && !map.has(extra)) map.set(extra, extra);
    }
    return [...map].map(([id, label]) => ({ id, label }));
  }, [browserZone, timezone]);

  // The zone the user effectively renders in until they pick one: saved → detected → ET.
  const effective = timezone ?? browserZone ?? 'America/New_York';

  const onChange = useCallback(
    (next: string): void => {
      const previous = timezone;
      setTimezone(next); // optimistic
      setSaving(true);
      setNote(null);
      apiClient
        .patch<{ timezone: string }>('/api/profile/timezone', { timezone: next })
        .then((d) => setTimezone(d.timezone))
        .catch((e: unknown) => {
          setTimezone(previous);
          setNote(e instanceof Error ? e.message : 'Could not save timezone');
        })
        .finally(() => setSaving(false));
    },
    [timezone],
  );

  return (
    <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex flex-col gap-1" htmlFor="tz-select">
        <span style={TYPE.body}>Your timezone</span>
        <select
          id="tz-select"
          value={effective}
          disabled={!loaded || saving}
          onChange={(event): void => onChange(event.target.value)}
          className="rounded-lg border px-2 py-1"
          style={{ borderColor: 'var(--border-subtle)', ...TYPE.body, maxWidth: '20rem' }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
        The app shows times in your device&rsquo;s timezone; this sets the zone for your daily-sync
        email.
        {timezone === null && browserZone !== null ? ` Detected ${browserZone}.` : ''}
      </span>
      {note !== null ? (
        <span role="alert" style={{ ...TYPE.label, color: 'var(--color-red-600)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
