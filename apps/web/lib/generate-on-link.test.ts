/**
 * Generate-on-link decision tests. When a client is linked to a meeting that was
 * already recorded with no client (transcript captured, docs held), linking must
 * auto-enqueue generation — but exactly once, and never when it doesn't apply.
 * Pure — no DB. Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldGenerateOnLink } from './generate-on-link.js';

const RECORDED_UNLINKED = {
  clientId: 'client-1',
  transcriptReceived: true,
  hasDocuments: false,
  pipelineStatus: 'cancelled' as const,
};

test('linking a client to a recorded, docs-held meeting enqueues generation', () => {
  assert.equal(shouldGenerateOnLink(RECORDED_UNLINKED), true);
});

test('no client (unlinked again / recompute cleared it) → do not generate', () => {
  assert.equal(shouldGenerateOnLink({ ...RECORDED_UNLINKED, clientId: null }), false);
});

test('transcript not captured yet → do not generate (normal transcript.done path will)', () => {
  // A client linked BEFORE the meeting records: generation runs later via the webhook.
  assert.equal(shouldGenerateOnLink({ ...RECORDED_UNLINKED, transcriptReceived: false }), false);
});

test('docs already exist → never double-generate (idempotent)', () => {
  assert.equal(shouldGenerateOnLink({ ...RECORDED_UNLINKED, hasDocuments: true }), false);
});

test('generation already in flight (processing) → do not re-enqueue', () => {
  assert.equal(shouldGenerateOnLink({ ...RECORDED_UNLINKED, pipelineStatus: 'processing' }), false);
});

test('a completed meeting that somehow lost its docs is still guarded by hasDocuments', () => {
  // complete + docs present is the normal happy path; complete + no docs would re-run,
  // which is the intended self-heal — the only hard stop is docs already existing.
  assert.equal(shouldGenerateOnLink({ ...RECORDED_UNLINKED, pipelineStatus: 'complete', hasDocuments: true }), false);
});
