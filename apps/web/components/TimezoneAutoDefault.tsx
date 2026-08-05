'use client';

import { useEffect, useRef } from 'react';

import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { isValidTimeZone } from '@/lib/timezones';

/**
 * One-shot self-heal: on first app load, if the signed-in user has no profile
 * timezone yet, default it from the browser (`Intl…resolvedOptions().timeZone`)
 * and PATCH the user. Renders nothing. Skips guests (no `internalId`) and users
 * who already have a zone. Best-effort — a failure just leaves the SSR fallback
 * (America/New_York) until the user sets a zone from the Calendar page.
 */
export function TimezoneAutoDefault(): null {
  const { user } = useAuth();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (user.internalId === null || user.timezone !== null) return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!isValidTimeZone(detected)) return;
    done.current = true; // fire at most once per mount, even before the PATCH resolves
    apiClient.patch('/api/profile/timezone', { timezone: detected }).catch(() => {
      // best-effort; falls back to America/New_York server-side until set manually.
    });
  }, [user.internalId, user.timezone]);

  return null;
}
