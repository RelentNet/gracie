/**
 * Plain-language reason-helper self-checks. Pure — no HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyAiFailure } from '@gracie/shared/constants';

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

test('AI account out of credits names the admin fix (not a bare re-run)', () => {
  const raw =
    'Failed after 3 attempts. Last error: AI_APICallError: You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.';
  const r = describePipelineState({ state: 'failed', errorMessage: raw, hasRecording: true });
  assert.match(r.headline, /out of credits/i);
  assert.match(r.headline, /admin/i);
  assert.equal(r.detail, raw);
});

test('classifyAiFailure: credits beat rate-limit wording; keys and throttling recognised; others ignored', () => {
  assert.equal(classifyAiFailure('429 You exceeded your current quota, please check your plan'), 'out_of_credits');
  assert.equal(classifyAiFailure('Error code: 429 - insufficient_quota'), 'out_of_credits');
  assert.equal(classifyAiFailure('Incorrect API key provided: sk-...'), 'bad_api_key');
  assert.equal(classifyAiFailure('Rate limit reached for gpt-4.1-mini'), 'rate_limited');
  assert.equal(classifyAiFailure('generate: Recall returned no transcript'), null);
  assert.equal(classifyAiFailure(null), null);
});
