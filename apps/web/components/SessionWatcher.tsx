'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TYPE } from '@/lib/typography';

/** The probe route. Excluded from the fetch observer so a probe never triggers itself. */
const SESSION_PATH = '/api/auth/session';
/** Re-check a quiet, open tab this often (a stale session is caught before a click). */
const HEARTBEAT_MS = 5 * 60_000;
/** Collapse bursts (e.g. a page firing five failing requests) into one probe. */
const MIN_PROBE_GAP_MS = 10_000;

/** Same-origin `/api/*` request (other than the probe itself)? */
function isAppApiRequest(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/') && url.pathname !== SESSION_PATH;
  } catch {
    return false;
  }
}

/**
 * Makes a stale sign-in OBVIOUS instead of silent. Previously a page kept rendering
 * off the login cookie while every action failed with a generic error, so users only
 * found out by trying something.
 *
 * Checks `/api/auth/session` (the same live Logto check actions use):
 *   - on load, when the tab becomes visible again, and every few minutes;
 *   - immediately after any `/api` response that is 401 — or 5xx, in case a route
 *     still reports an auth failure as a server error.
 * On a 401 it shows a blocking "session expired" dialog whose button signs in and
 * returns to this page. Network failures are ignored: offline ≠ signed out.
 *
 * ponytail: observes `window.fetch` once here rather than threading a handler through
 * `apiClient` + ~25 raw fetch call sites; this catches every current and future caller.
 * Unsaved form input is lost on re-sign-in — add draft persistence if that bites.
 */
export function SessionWatcher(): React.JSX.Element | null {
  const [expired, setExpired] = useState(false);
  const lastProbe = useRef(0);
  const inFlight = useRef(false);
  const originalFetch = useRef<typeof window.fetch | null>(null);

  const probe = useCallback(async (): Promise<void> => {
    const now = Date.now();
    if (inFlight.current || now - lastProbe.current < MIN_PROBE_GAP_MS) return;
    inFlight.current = true;
    lastProbe.current = now;
    try {
      const doFetch = originalFetch.current ?? window.fetch;
      const res = await doFetch(SESSION_PATH, { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) setExpired(true);
    } catch {
      // Offline / transient — not evidence the session is stale.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const original = window.fetch;
    originalFetch.current = original;
    const observed: typeof window.fetch = async (input, init) => {
      const res = await original(input, init);
      if ((res.status === 401 || res.status >= 500) && isAppApiRequest(input)) void probe();
      return res;
    };
    window.fetch = observed;

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void probe();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void probe(), HEARTBEAT_MS);
    void probe();

    return (): void => {
      if (window.fetch === observed) window.fetch = original;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [probe]);

  if (!expired) return null;

  const signInAgain = (): void => {
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/sign-in?returnTo=${encodeURIComponent(here)}`;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)' }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-body"
        className="flex w-full max-w-md flex-col gap-4 rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="session-expired-title" style={TYPE.sectionHeader}>
          Your session has expired
        </h2>
        <p id="session-expired-body" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          For your security, you’ve been signed out. Sign in again to keep working — you’ll come right back
          to this page.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={signInAgain} autoFocus>
            Sign in again
          </Button>
        </div>
      </div>
    </div>
  );
}
