/**
 * Task-lifecycle tests (tasks lifecycle core). Covers the PURE logic the generate
 * processor + nightly aging sweep apply: description dedup/normalization, the
 * insert/escalate/reactivate decision, the per-client active cap, owner-on-name
 * resolution, and the aging cutoff.
 *
 * Pure — no DB or network. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agingCutoffIso,
  decideCapEvictions,
  decideTaskUpsert,
  findDuplicateTask,
  isDuplicateDescription,
  MAX_ACTIVE_TASKS_PER_CLIENT,
  normalizeDescription,
  resolveOwnerFromText,
  resolveTaskOwner,
  STANDARD_TASK_TTL_DAYS,
} from './task-lifecycle.js';

test('normalizeDescription lowercases, strips punctuation, collapses whitespace', () => {
  assert.equal(normalizeDescription('  Send the Proposal!!! '), 'send the proposal');
  assert.equal(normalizeDescription('Follow-up  with\tClient'), 'follow up with client');
});

test('isDuplicateDescription matches identical and stopword-only variants', () => {
  assert.equal(isDuplicateDescription('Send the proposal', 'Send proposal'), true);
  assert.equal(isDuplicateDescription('Send proposal to Acme.', 'send proposal to acme'), true);
  assert.equal(
    isDuplicateDescription('Follow up with the client next week', 'Follow up with client'),
    true,
  );
});

test('isDuplicateDescription rejects clearly different tasks', () => {
  assert.equal(isDuplicateDescription('Send the proposal', 'Schedule the kickoff call'), false);
  assert.equal(isDuplicateDescription('Review the budget', 'Draft the contract'), false);
});

test('isDuplicateDescription falls back to exact match for all-stopword descriptions', () => {
  // Both signatures empty → exact normalized equality, not a false-positive match.
  assert.equal(isDuplicateDescription('to the', 'to the'), true);
  assert.equal(isDuplicateDescription('to the', 'of a'), false);
});

test('findDuplicateTask returns the first matching existing task', () => {
  const existing = [
    { id: '1', description: 'Schedule kickoff' },
    { id: '2', description: 'Send the proposal to the client' },
  ];
  assert.equal(findDuplicateTask('send proposal to client', existing)?.id, '2');
  assert.equal(findDuplicateTask('order more coffee', existing), null);
});

test('decideTaskUpsert: no match → insert (high only when flagged)', () => {
  assert.deepEqual(decideTaskUpsert({ priority: false }, null), { kind: 'insert', high: false });
  assert.deepEqual(decideTaskUpsert({ priority: true }, null), { kind: 'insert', high: true });
});

test('decideTaskUpsert: active dup → escalate; archived dup → reactivate', () => {
  assert.deepEqual(decideTaskUpsert({ priority: false }, { id: 'a', archived: false }), {
    kind: 'escalate',
    id: 'a',
  });
  assert.deepEqual(decideTaskUpsert({ priority: false }, { id: 'b', archived: true }), {
    kind: 'reactivate',
    id: 'b',
  });
});

test('decideCapEvictions evicts the stalest standard tasks down to the cap', () => {
  const active = [
    { id: 'old-standard', priorityFlag: false, updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'mid-standard', priorityFlag: false, updatedAt: '2026-02-01T00:00:00Z', createdAt: '2026-02-01T00:00:00Z' },
    { id: 'high', priorityFlag: true, updatedAt: '2026-01-15T00:00:00Z', createdAt: '2026-01-15T00:00:00Z' },
    { id: 'new-standard', priorityFlag: false, updatedAt: '2026-03-01T00:00:00Z', createdAt: '2026-03-01T00:00:00Z' },
  ];
  // cap 3, one over → evict the single stalest standard task.
  assert.deepEqual(decideCapEvictions(active, 3), ['old-standard']);
});

test('decideCapEvictions never evicts high tasks even when over cap', () => {
  const active = [
    { id: 'h1', priorityFlag: true, updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'h2', priorityFlag: true, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'h3', priorityFlag: true, updatedAt: '2026-01-03T00:00:00Z', createdAt: '2026-01-03T00:00:00Z' },
    { id: 's1', priorityFlag: false, updatedAt: '2026-01-04T00:00:00Z', createdAt: '2026-01-04T00:00:00Z' },
  ];
  // 4 active, cap 3 → the only evictable is the lone standard task.
  assert.deepEqual(decideCapEvictions(active, 3), ['s1']);
});

test('decideCapEvictions is a no-op at or under the cap', () => {
  const active = [
    { id: 'a', priorityFlag: false, updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'b', priorityFlag: false, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' },
  ];
  assert.deepEqual(decideCapEvictions(active, MAX_ACTIVE_TASKS_PER_CLIENT), []);
});

test('resolveTaskOwner assigns only on a clear name match', () => {
  const users = [
    { id: 'u1', name: 'Sarah Chen', email: 'sarah@ga.com' },
    { id: 'u2', name: 'Daniel Velez', email: 'daniel@ga.com' },
  ];
  assert.equal(resolveTaskOwner('Sarah Chen', users), 'u1');
  assert.equal(resolveTaskOwner('sarah', users), 'u1'); // first-name token
  assert.equal(resolveTaskOwner('daniel@ga.com', users), 'u2');
  assert.equal(resolveTaskOwner('daniel', users), 'u2'); // email local-part
});

test('resolveTaskOwner leaves owner null when no name is clearly present', () => {
  const users = [{ id: 'u1', name: 'Sarah Chen', email: 'sarah@ga.com' }];
  assert.equal(resolveTaskOwner(null, users), null);
  assert.equal(resolveTaskOwner('', users), null);
  assert.equal(resolveTaskOwner('the team', users), null);
  // Loose substring must NOT match (would mis-assign): "cha" is inside "Chen".
  assert.equal(resolveTaskOwner('cha', users), null);
});

test('resolveOwnerFromText assigns from a named staffer in a freeform sentence (voice path)', () => {
  const users = [
    { id: 'u1', name: 'Sarah Chen', email: 'sarah@ga.com' },
    { id: 'u2', name: 'Daniel Velez', email: 'daniel@ga.com' },
  ];
  assert.equal(resolveOwnerFromText('send the Q3 proposal to Sarah', users), 'u1');
  assert.equal(resolveOwnerFromText('Daniel should draft the SOW', users), 'u2');
  assert.equal(resolveOwnerFromText('follow up with the client next week', users), null);
});

test('agingCutoffIso is TTL days before now', () => {
  const now = new Date('2026-08-05T00:00:00Z');
  const cutoff = new Date(agingCutoffIso(now));
  const days = (now.getTime() - cutoff.getTime()) / 86_400_000;
  assert.equal(days, STANDARD_TASK_TTL_DAYS);
});
