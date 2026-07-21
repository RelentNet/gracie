/**
 * One-bot-per-real-call dedupe tests (2026-07-21 double-dispatch fix). Two
 * distinct Outlook invites can point at the same real call (same join URL, same
 * start) — each used to get its own bot, and a client saw two "Gracie"
 * notetakers. Dispatch now dedupes on (video_link + exact start) via
 * `callKey`/`createCallCoverage`. These tests pin BOTH sides of the rule:
 *   - duplicate invites (same link + same start) → exactly ONE dispatch;
 *   - a recurring series (same link, DIFFERENT starts) → one dispatch EACH —
 *     deduping on the link alone would suppress every recurrence after the first.
 *
 * Pure: exercises the exported dedupe state the sweep loop uses; no DB/network.
 * Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callKey, createCallCoverage } from './bot-dispatch.processor.js';

const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0';

/**
 * Run candidates through the exact decision the sweep loop makes: skip when the
 * call is covered, otherwise dispatch and mark it covered. Returns dispatched ids.
 */
function sweep(
  candidates: ReadonlyArray<{ id: string; video_link: string; date_time: string }>,
  coveredKeys: readonly string[] = [],
): string[] {
  const coverage = createCallCoverage(coveredKeys);
  const dispatched: string[] = [];
  for (const meeting of candidates) {
    if (coverage.isCovered(meeting.video_link, meeting.date_time)) continue;
    dispatched.push(meeting.id);
    coverage.markCovered(meeting.video_link, meeting.date_time);
  }
  return dispatched;
}

test('callKey: equal instants compare equal across Postgres/ISO timestamp formats', () => {
  // PostgREST emits `2026-07-21T14:00:00+00:00`; raw SQL shows `2026-07-21 14:00:00+00`.
  assert.equal(callKey(TEAMS_LINK, '2026-07-21 14:00:00+00'), callKey(TEAMS_LINK, '2026-07-21T14:00:00+00:00'));
  assert.equal(callKey(TEAMS_LINK, '2026-07-21T14:00:00.000Z'), callKey(TEAMS_LINK, '2026-07-21 14:00:00+00'));
});

test('callKey: same link on different dates (recurring series) yields distinct keys', () => {
  assert.notEqual(callKey(TEAMS_LINK, '2026-07-21 14:00:00+00'), callKey(TEAMS_LINK, '2026-08-04 14:00:00+00'));
});

test('duplicate invites — same link + same start → exactly one dispatch', () => {
  const dispatched = sweep([
    { id: 'invite-a', video_link: TEAMS_LINK, date_time: '2026-07-21 14:00:00+00' },
    { id: 'invite-b', video_link: TEAMS_LINK, date_time: '2026-07-21T14:00:00+00:00' },
  ]);
  assert.deepEqual(dispatched, ['invite-a']);
});

test('recurring series — same link, different starts → one dispatch each', () => {
  const dispatched = sweep([
    { id: 'occ-jul-21', video_link: TEAMS_LINK, date_time: '2026-07-21 14:00:00+00' },
    { id: 'occ-aug-04', video_link: TEAMS_LINK, date_time: '2026-08-04 14:00:00+00' },
  ]);
  assert.deepEqual(dispatched, ['occ-jul-21', 'occ-aug-04']);
});

test('a call already covered by a confirmed bot (earlier sweep / on-demand join) is skipped', () => {
  const covered = [callKey(TEAMS_LINK, '2026-07-21T14:00:00+00:00')];
  const dispatched = sweep(
    [
      { id: 'duplicate-invite', video_link: TEAMS_LINK, date_time: '2026-07-21 14:00:00+00' },
      { id: 'other-call', video_link: 'https://teams.microsoft.com/other', date_time: '2026-07-21 14:00:00+00' },
    ],
    covered,
  );
  assert.deepEqual(dispatched, ['other-call']);
});

test('same start time on different links never dedupes', () => {
  const dispatched = sweep([
    { id: 'call-x', video_link: `${TEAMS_LINK}?x=1`, date_time: '2026-07-21 14:00:00+00' },
    { id: 'call-y', video_link: `${TEAMS_LINK}?x=2`, date_time: '2026-07-21 14:00:00+00' },
  ]);
  assert.deepEqual(dispatched, ['call-x', 'call-y']);
});
