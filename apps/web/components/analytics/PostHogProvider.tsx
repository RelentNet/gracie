'use client';

/**
 * Client-side PostHog product analytics (privacy-first).
 *
 * Mounted once in the root layout (app/layout.tsx) wrapping the whole tree. It:
 *  - initializes PostHog exactly once, client-side, and ONLY in production with a
 *    real key — so local dev never pollutes the dashboard and a missing key is a
 *    clean no-op (posthog stays uninitialized; lib/analytics.ts `capture` no-ops);
 *  - captures a `$pageview` on every App-Router client navigation (the SDK's own
 *    pageview only fires on hard loads — hence `capture_pageview: false` + the
 *    manual PageView tracker below, wrapped in <Suspense> because useSearchParams
 *    forces a Suspense boundary during static generation);
 *  - identifies the logged-in user (skips guests / logged-out).
 *
 * Privacy: NO session recording (this app holds client transcripts, contacts and
 * financials); autocapture (element-level clicks/pageviews) is on — no full-text
 * or session capture; the browser Do-Not-Track signal is respected.
 */
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

/**
 * Init only in a production build with a non-empty key. Module-scope constant so
 * the useEffect below has no reactive dependency on it (env is fixed at build).
 */
const ANALYTICS_ENABLED =
  process.env.NODE_ENV === 'production' && typeof KEY === 'string' && KEY.length > 0;

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
      // App Router: the default one-shot pageview misses client navigations — we
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
      <Suspense fallback={null}>
        <PageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}

/**
 * Fires `$pageview` on each App-Router client navigation. `useSearchParams`
 * requires a Suspense boundary (the caller wraps this) or the build de-opts /
 * warns. No-ops until PostHog is initialized.
 */
function PageView(): null {
  const client = usePostHog();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || !client.__loaded) return;
    let url = window.origin + pathname;
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
    client.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams, client]);

  return null;
}
