/**
 * Task-Board visibility gate self-checks. Pure — no HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canSeeTaskBoard } from './client-display';

test('canSeeTaskBoard: admins / board-managers always see it, toggle or not', () => {
  assert.equal(canSeeTaskBoard(true, false), true);
  assert.equal(canSeeTaskBoard(true, true), true);
});

test('canSeeTaskBoard: non-admins see it only once revealed to all', () => {
  assert.equal(canSeeTaskBoard(false, false), false); // default: admin-only
  assert.equal(canSeeTaskBoard(false, true), true); // operator flipped it on
});
