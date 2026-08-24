/**
 * Thin, safe wrapper around PostHog custom events.
 *
 * Everything here tolerates PostHog being UNINITIALIZED — which is the normal
 * state in local dev, in any build without `NEXT_PUBLIC_POSTHOG_KEY`, and on the
 * server. `posthog.init()` only runs client-side in production (see
 * components/analytics/PostHogProvider.tsx); until it has, `posthog.__loaded` is
 * false and `capture()` is a silent no-op rather than a console warning or crash.
 *
 * v1 keeps this minimal on purpose: autocapture + pageviews + identify already
 * cover the dashboard. Sprinkle `capture('some_event', {...})` at call sites later
 * as concrete needs appear — do not instrument speculative events now.
 */
import posthog from 'posthog-js';

export function capture(event: string, props?: Record<string, unknown>): void {
  if (!posthog.__loaded) return;
  posthog.capture(event, props);
}
