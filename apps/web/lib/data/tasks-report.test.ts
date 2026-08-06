/**
 * Self-checks for the pure task-report helpers (filterTasks + tasksToCsv). No DB,
 * no HTTP. Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Task } from '@gracie/shared';

import { filterTasks, tasksToCsv, TASK_CSV_HEADER } from './tasks-report';

/** A task with sensible defaults; override any field per case. */
function task(overrides: Partial<Task>): Task {
  return {
    id: 'id',
    clientId: 'client-a',
    sourceMeetingId: null,
    sourceDocumentId: null,
    description: 'Do the thing',
    ownerUserId: null,
    dueDate: null,
    status: 'open',
    hasPriorityFlag: false,
    isArchived: false,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-08-06T12:00:00.000Z');

// --- filterTasks --------------------------------------------------------------

test('filterTasks: no filter returns everything', () => {
  const tasks = [task({ id: '1' }), task({ id: '2' })];
  assert.equal(filterTasks(tasks, {}, NOW).length, 2);
});

test('filterTasks: status', () => {
  const tasks = [task({ id: '1', status: 'open' }), task({ id: '2', status: 'complete' })];
  const out = filterTasks(tasks, { status: 'complete' }, NOW);
  assert.deepEqual(out.map((t) => t.id), ['2']);
});

test('filterTasks: overdue excludes complete and future/no due dates', () => {
  const tasks = [
    task({ id: 'past-open', dueDate: '2026-08-01', status: 'open' }),
    task({ id: 'past-done', dueDate: '2026-08-01', status: 'complete' }),
    task({ id: 'future', dueDate: '2026-08-31', status: 'open' }),
    task({ id: 'none', dueDate: null, status: 'open' }),
    task({ id: 'today', dueDate: '2026-08-06', status: 'open' }), // due today ≠ overdue
  ];
  const out = filterTasks(tasks, { overdue: true }, NOW);
  assert.deepEqual(out.map((t) => t.id), ['past-open']);
});

test('filterTasks: client', () => {
  const tasks = [task({ id: '1', clientId: 'a' }), task({ id: '2', clientId: 'b' })];
  assert.deepEqual(filterTasks(tasks, { clientId: 'b' }, NOW).map((t) => t.id), ['2']);
});

test('filterTasks: owner by id vs unassigned', () => {
  const tasks = [
    task({ id: 'mine', ownerUserId: 'u1' }),
    task({ id: 'theirs', ownerUserId: 'u2' }),
    task({ id: 'nobody', ownerUserId: null }),
  ];
  assert.deepEqual(filterTasks(tasks, { ownerUserId: 'u1' }, NOW).map((t) => t.id), ['mine']);
  // null selects UNASSIGNED, not "any"
  assert.deepEqual(filterTasks(tasks, { ownerUserId: null }, NOW).map((t) => t.id), ['nobody']);
});

test('filterTasks: recency matches created OR updated inside the window', () => {
  const tasks = [
    task({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' }),
    task({ id: 'created-recent', createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }),
    // created long ago but touched yesterday → still "recent"
    task({ id: 'updated-recent', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z' }),
  ];
  const out = filterTasks(tasks, { recentDays: 7 }, NOW);
  assert.deepEqual(out.map((t) => t.id).sort(), ['created-recent', 'updated-recent']);
});

test('filterTasks: combined owner + status + recency AND together', () => {
  const tasks = [
    task({ id: 'hit', ownerUserId: 'u1', status: 'open', updatedAt: '2026-08-05T00:00:00.000Z' }),
    task({ id: 'wrong-owner', ownerUserId: 'u2', status: 'open', updatedAt: '2026-08-05T00:00:00.000Z' }),
    task({ id: 'wrong-status', ownerUserId: 'u1', status: 'complete', updatedAt: '2026-08-05T00:00:00.000Z' }),
    task({ id: 'too-old', ownerUserId: 'u1', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  const out = filterTasks(tasks, { ownerUserId: 'u1', status: 'open', recentDays: 7 }, NOW);
  assert.deepEqual(out.map((t) => t.id), ['hit']);
});

// --- tasksToCsv ---------------------------------------------------------------

const CLIENT_NAMES = new Map([['client-a', 'Cotiviti']]);
const OWNER_NAMES = new Map([['u1', 'Allie Grace']]);

test('tasksToCsv: header row matches the column contract', () => {
  const csv = tasksToCsv([], CLIENT_NAMES, OWNER_NAMES);
  assert.equal(csv, `${TASK_CSV_HEADER.join(',')}\r\n`);
});

test('tasksToCsv: resolves names, priority, status, dates', () => {
  const csv = tasksToCsv(
    [
      task({
        clientId: 'client-a',
        description: 'Send Q3 report',
        ownerUserId: 'u1',
        hasPriorityFlag: true,
        status: 'in_progress',
        createdAt: '2026-08-01T09:30:00.000Z',
        updatedAt: '2026-08-05T18:00:00.000Z',
        dueDate: '2026-08-10',
      }),
    ],
    CLIENT_NAMES,
    OWNER_NAMES,
  );
  const [, dataRow] = csv.trimEnd().split('\r\n');
  assert.equal(
    dataRow,
    'Cotiviti,Send Q3 report,Allie Grace,High,In Progress,2026-08-01,2026-08-05,2026-08-10',
  );
});

test('tasksToCsv: unknown client → Internal, no owner → Unassigned, unknown owner → Unknown', () => {
  const csv = tasksToCsv(
    [
      task({ id: '1', clientId: 'ga-internal', ownerUserId: null }),
      task({ id: '2', clientId: 'client-a', ownerUserId: 'ghost' }),
    ],
    CLIENT_NAMES,
    OWNER_NAMES,
  );
  const [internalRow, unknownOwnerRow] = csv.trimEnd().split('\r\n').slice(1);
  assert.ok(internalRow !== undefined && /^Internal,.*,Unassigned,/.test(internalRow));
  assert.ok(unknownOwnerRow !== undefined && /^Cotiviti,.*,Unknown,/.test(unknownOwnerRow));
});

test('tasksToCsv: escapes commas, quotes, and newlines (RFC 4180)', () => {
  const csv = tasksToCsv(
    [task({ description: 'Call Bob, then email "the team"\nurgent' })],
    CLIENT_NAMES,
    OWNER_NAMES,
  );
  assert.ok(csv.includes('"Call Bob, then email ""the team""\nurgent"'));
});
