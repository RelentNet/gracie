/**
 * Self-heal watchdog decision tests (fix/pipeline-selfheal-recovery, brief §3.4).
 * `decideWatchdogAction` is the PURE core: given a meeting's Recall recoverability
 * and how many automatic re-transcribe attempts it has already had, it decides
 * whether to re-queue generation, request async transcription, wait, or escalate.
 * The processor performs the DB/Recall/queue side effects around it.
 *
 * Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RecallRecoverability } from '@gracie/shared/recall';

import { decideWatchdogAction } from './watchdog.processor.js';

const MAX = 2;

function recoverability(over: Partial<RecallRecoverability>): RecallRecoverability {
  return { state: 'retranscribe', recordingId: 'rec_1', transcriptPending: false, detail: null, ...over };
}

test('regenerate → re-queue generation (transcript is ready, generation never ran)', () => {
  assert.deepEqual(decideWatchdogAction(recoverability({ state: 'regenerate' }), 0, MAX), { kind: 'regenerate' });
});

test('retranscribe under the cap → request async transcription on the surviving recording', () => {
  assert.deepEqual(decideWatchdogAction(recoverability({ recordingId: 'rec_9' }), 0, MAX), {
    kind: 'retranscribe',
    recordingId: 'rec_9',
  });
  // Still under the cap on the second attempt.
  assert.deepEqual(decideWatchdogAction(recoverability({ recordingId: 'rec_9' }), 1, MAX), {
    kind: 'retranscribe',
    recordingId: 'rec_9',
  });
});

test('retranscribe with a transcript already in flight → wait (no stacked request, no wasted attempt)', () => {
  const action = decideWatchdogAction(recoverability({ transcriptPending: true }), 0, MAX);
  assert.equal(action.kind, 'wait');
});

test('retranscribe once the cap is reached → escalate (bounded: no infinite loop / cost)', () => {
  const action = decideWatchdogAction(recoverability({}), MAX, MAX);
  assert.equal(action.kind, 'escalate');
  assert.ok(action.kind === 'escalate' && action.reason.length > 0, 'escalation carries a plain-language reason');
});

test('unrecoverable (no recording) → escalate, never a doomed retry', () => {
  const action = decideWatchdogAction(recoverability({ state: 'unrecoverable', recordingId: null }), 0, MAX);
  assert.equal(action.kind, 'escalate');
});

test('retranscribe under the cap but missing a recording id → escalate (nothing to point at)', () => {
  const action = decideWatchdogAction(recoverability({ recordingId: null }), 0, MAX);
  assert.equal(action.kind, 'escalate');
});
