/**
 * Plain-language reason-helper self-checks. Pure — no HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describePipelineState } from './pipeline-reason';

test('provider transcript failure reads as recording-fine, notes-failed (never the raw code)', () => {
  const r = describePipelineState({
    state: 'failed',
    errorMessage: 'transcript status failed: provider_connection_failed',
    hasRecording: true,
  });
  assert.match(r.headline, /recording is fine/i);
  assert.doesNotMatch(r.headline, /provider_connection_failed/); // raw code stays out of the headline
  assert.equal(r.detail, 'transcript status failed: provider_connection_failed'); // kept for support
});

test('no recording → nothing to recover (both failed and needs_attention)', () => {
  for (const state of ['failed', 'needs_attention'] as const) {
    const r = describePipelineState({ state, hasRecording: false });
    assert.match(r.headline, /nothing to recover/i);
  }
});

test('needs_attention with a recording tells staff to re-run', () => {
  const r = describePipelineState({ state: 'needs_attention', hasRecording: true });
  assert.match(r.headline, /re-run/i);
});

test('skipped surfaces the plain-language note as the headline', () => {
  const r = describePipelineState({ state: 'skipped', errorMessage: 'Not dispatched — another bot covers this call.' });
  assert.equal(r.headline, 'Not dispatched — another bot covers this call.');
});

test('success has no error detail', () => {
  assert.equal(describePipelineState({ state: 'success' }).detail, null);
});
