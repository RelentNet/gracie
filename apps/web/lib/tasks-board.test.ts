/**
 * Task Board redesign — pure grouping/selection/color self-checks. No HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Task } from '@gracie/shared';

import {
  clientWithLatestMeeting,
  groupTasksByMeetingDate,
  localDateKey,
  mostRecentMeetingKey,
  NO_MEETING_KEY,
  taskColor,
} from './tasks-board';

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    clientId: 'client-1',
    sourceMeetingId: null,
    sourceDocumentId: null,
    sourceMeetingAt: null,
    description: 'A task',
    ownerUserId: null,
    dueDate: null,
    status: 'open',
    hasPriorityFlag: false,
    isArchived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('localDateKey: UTC timestamp → ISO-order YYYY-MM-DD in the given zone', () => {
  assert.equal(localDateKey('2026-08-20T15:00:00.000Z', 'UTC'), '2026-08-20');
  // Late-UTC time rolls back a day in a western zone (America/New_York = UTC-4 in Aug).
  assert.equal(localDateKey('2026-08-21T02:00:00.000Z', 'America/New_York'), '2026-08-20');
});

test('groupTasksByMeetingDate: buckets by local meeting date, newest first, no-meeting last', () => {
  const tasks: readonly Task[] = [
    task({ id: 'a', sourceMeetingAt: '2026-08-10T14:00:00.000Z' }),
    task({ id: 'b', sourceMeetingAt: '2026-08-20T14:00:00.000Z' }),
    task({ id: 'c', sourceMeetingAt: '2026-08-20T16:00:00.000Z' }),
    task({ id: 'd', sourceMeetingAt: null }), // manual / document task
  ];
  const groups = groupTasksByMeetingDate(tasks, 'UTC');

  assert.deepEqual(
    groups.map((g) => g.dateKey),
    ['2026-08-20', '2026-08-10', null],
  );
  const [newest, , undated] = groups;
  assert.ok(newest !== undefined && undated !== undefined);
  // Same-day tasks land together; representative timestamp is the latest of the day.
  assert.deepEqual(newest.tasks.map((t) => t.id), ['b', 'c']);
  assert.equal(newest.meetingAt, '2026-08-20T16:00:00.000Z');
  // No-meeting tasks stay reachable in the trailing null bucket.
  assert.equal(undated.dateKey, null);
  assert.deepEqual(undated.tasks.map((t) => t.id), ['d']);
});

test('mostRecentMeetingKey: first dated group, or null when nothing is meeting-linked', () => {
  const dated = groupTasksByMeetingDate(
    [
      task({ id: 'a', sourceMeetingAt: '2026-08-10T14:00:00.000Z' }),
      task({ id: 'b', sourceMeetingAt: '2026-08-20T14:00:00.000Z' }),
    ],
    'UTC',
  );
  assert.equal(mostRecentMeetingKey(dated), '2026-08-20');

  const undatedOnly = groupTasksByMeetingDate([task({ id: 'x', sourceMeetingAt: null })], 'UTC');
  assert.equal(mostRecentMeetingKey(undatedOnly), null);
});

test('clientWithLatestMeeting: the client of the newest meeting-linked task', () => {
  const tasks: readonly Task[] = [
    task({ id: 'a', clientId: 'acme', sourceMeetingAt: '2026-08-10T14:00:00.000Z' }),
    task({ id: 'b', clientId: 'globex', sourceMeetingAt: '2026-08-22T14:00:00.000Z' }),
    task({ id: 'c', clientId: 'initech', sourceMeetingAt: null }),
  ];
  assert.equal(clientWithLatestMeeting(tasks), 'globex');
  assert.equal(clientWithLatestMeeting([task({ sourceMeetingAt: null })]), null);
});

test('taskColor: complete is green, everything else neutral', () => {
  assert.equal(taskColor(task({ status: 'complete' })), 'complete');
  assert.equal(taskColor(task({ status: 'open' })), 'neutral');
  assert.equal(taskColor(task({ status: 'in_progress' })), 'neutral');
});

test('NO_MEETING_KEY is a stable sentinel distinct from any date key', () => {
  assert.equal(NO_MEETING_KEY, '__none__');
  assert.notEqual(NO_MEETING_KEY, localDateKey('2026-08-20T00:00:00.000Z', 'UTC'));
});
