import assert from 'node:assert/strict';
import { test } from 'node:test';

import posthog from 'posthog-js';

import { capture } from './analytics';

// The interesting logic in analytics.ts is the uninitialized guard: PostHog is
// only ever init()'d client-side in production, so in every test/dev/SSR context
// capture() must no-op rather than throw or emit a console warning.
test('capture no-ops when posthog is uninitialized', () => {
  assert.ok(!posthog.__loaded, 'precondition: posthog must be uninitialized here');

  let calls = 0;
  const original = posthog.capture;
  posthog.capture = ((): void => {
    calls += 1;
  }) as typeof posthog.capture;

  try {
    assert.doesNotThrow(() => {
      capture('test_event', { a: 1 });
    });
    assert.equal(calls, 0, 'underlying posthog.capture must not be reached when uninitialized');
  } finally {
    posthog.capture = original;
  }
});
