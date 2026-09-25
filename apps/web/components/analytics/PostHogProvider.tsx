'use client';

/**
 * Client-side PostHog product analytics (privacy-first).
 *
 * Mounted once at the app root (src/main.tsx) wrapping the whole tree. It:
 *  - initializes PostHog exactly once, client-side, and ONLY in production with a
 *    real key — so local dev never pollutes the dashboard and a missing key is a
 *    clean no-op (posthog stays uninitialized; lib/analytics.ts `capture` no-ops);
 *  - captures a `$pageview` on every client-side navigation (the SDK's own
 *    pageview only fires on hard loads — hence `capture_pageview: false` + the
 *    manual PageView tracker below);
 *  - identifies the logged-in user (skips guests / logged-out).
 *
 * Privacy: NO session recording (this app holds client transcripts, contacts and
 * financials); autocapture (element-level clicks/pageviews) is on — no full-text
 * or session capture; the browser Do-Not-Track signal is respected.
 */
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';

const KEY = import.meta.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.NEXT_PUBLIC_POSTHOG_HOST;

/**
 * Init only in a production build with a non-empty key. Module-scope constant so
 * the useEffect below has no reactive dependency on it (env is fixed at build).
 */
const ANALYTICS_ENABLED = import.meta.env.PROD && typeof KEY === 'string' && KEY.length > 0;

/** Trimmed identity — never send more than PostHog needs for a person profile. */
export interface AnalyticsUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: string;
}

export function PostHogProvider({
  user,
  children,
}: {
  readonly user: AnalyticsUser | null;
  readonly children: ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    if (!ANALYTICS_ENABLED || posthog.__loaded) return;
    posthog.init(KEY as string, {
      api_host: HOST,
      // SPA: the default one-shot pageview misses client navigations — we
      // fire $pageview manually in <PageView> on every route change instead.
      capture_pageview: false,
      // Element-level clicks/pageviews only. Intentionally NO full-text capture.
      autocapture: true,
      // Hard privacy floor: no screen replay of transcripts/contacts/financials.
      disable_session_recording: true,
      // Privacy-first: honor the browser Do-Not-Track signal.
      respect_dnt: true,
    });
  }, []);

  const userId = user?.id;
  const userEmail = user?.email;
  const userName = user?.name;
  const userRole = user?.role;

  useEffect(() => {
    if (!ANALYTICS_ENABLED || !posthog.__loaded) return;
    // Skip the guest placeholder / logged-out routes (id 'guest', empty email).
    if (!userId || userId === 'guest' || !userEmail) return;
    posthog.identify(userId, { email: userEmail, name: userName, role: userRole });
  }, [userId, userEmail, userName, userRole]);

  return (
    <PHProvider client={posthog}>
      <PageView />
      {children}
    </PHProvider>
  );
}

/**
 * Fires `$pageview` on each client-side navigation. No-ops until PostHog is
 * initialized.
 */
function PageView(): null {
  const client = usePostHog();
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!pathname || !client.__loaded) return;
    client.capture('$pageview', { $current_url: window.origin + pathname + search });
  }, [pathname, search, client]);

  return null;
}
