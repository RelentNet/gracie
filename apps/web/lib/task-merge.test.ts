/**
 * Pure merge-combine self-checks (the Task Board bulk "Merge" action). No DB — the
 * data-layer mergeTasks() re-parents notes + deletes rows around this logic.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineMergedTasks, tasksShareClient } from '@gracie/shared/tasks';

const t = (clientId: string, description: string, priorityFlag = false) => ({
  clientId,
  description,
  priorityFlag,
});

test('combineMergedTasks keeps the survivor first and folds the others in', () => {
  const out = combineMergedTasks([
    t('c1', 'Send the proposal'),
    t('c1', 'Book the follow-up call'),
    t('c1', 'Draft the SOW'),
  ]);
  assert.equal(
    out.description,
    'Send the proposal\n\nMerged in:\n• Book the follow-up call\n• Draft the SOW',
  );
});

test('combineMergedTasks takes the highest priority (any high → high)', () => {
  assert.equal(combineMergedTasks([t('c1', 'a'), t('c1', 'b', true)]).priorityFlag, true);
  assert.equal(combineMergedTasks([t('c1', 'a'), t('c1', 'b')]).priorityFlag, false);
});

test('combineMergedTasks drops descriptions that exactly restate the survivor', () => {
  // "send the proposal!" normalizes (case/punctuation) to the survivor → not re-appended;
  // dedup is deliberately conservative (exact restatement only) so real content is never lost.
  const out = combineMergedTasks([
    t('c1', 'Send the proposal'),
    t('c1', 'send the proposal!'),
    t('c1', 'Call the client'),
  ]);
  assert.equal(out.description, 'Send the proposal\n\nMerged in:\n• Call the client');
});

test('combineMergedTasks with only the survivor leaves its description untouched', () => {
  assert.equal(combineMergedTasks([t('c1', '  Trim me  ')]).description, 'Trim me');
});

test('combineMergedTasks throws on an empty selection', () => {
  assert.throws(() => combineMergedTasks([]), /no tasks to merge/);
});

test('tasksShareClient guards cross-client selections', () => {
  assert.equal(tasksShareClient([t('c1', 'a'), t('c1', 'b')]), true);
  assert.equal(tasksShareClient([t('c1', 'a'), t('c2', 'b')]), false);
  assert.equal(tasksShareClient([]), false);
  assert.equal(tasksShareClient([t('c1', 'a')]), true);
});
