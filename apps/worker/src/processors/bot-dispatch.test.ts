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

import {
  callKey,
  createCallCoverage,
  decideDispatch,
  isMeetingIgnored,
} from './bot-dispatch.processor.js';

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

/*
 * decideDispatch — the per-candidate rule after the client-eligibility gate was
 * removed (2026-08-04, operator directive "record every meeting"). The only skips
 * left are: lead opted out, no join link, or a call another bot already covers.
 * Crucially, an UNLINKED meeting (no client, not internal) now DISPATCHES.
 */
const NO_OPTOUT = {
  optedOut: new Set<string>(),
  ignoredKeys: new Set<string>(),
  coverage: createCallCoverage(),
};
const AT = '2026-07-21 14:00:00+00';

test('decideDispatch: an UNLINKED meeting (no client, not internal) dispatches', () => {
  // The whole point of the change — no eligibility field is even consulted.
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: 'lead-1', series_id: null },
      NO_OPTOUT,
    ),
    'dispatch',
  );
  // …and with no lead at all.
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: null, series_id: null },
      NO_OPTOUT,
    ),
    'dispatch',
  );
});

test('decideDispatch: a lead who opted out of auto-join is skipped', () => {
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: 'lead-1', series_id: null },
      { optedOut: new Set(['lead-1']), ignoredKeys: new Set(), coverage: createCallCoverage() },
    ),
    'skip_opted_out',
  );
});

test('decideDispatch: a meeting with no join link is skipped', () => {
  assert.equal(
    decideDispatch(
      { video_link: null, date_time: AT, meeting_lead_user_id: null, series_id: null },
      NO_OPTOUT,
    ),
    'skip_no_link',
  );
});

test('decideDispatch: a call already covered by another bot is skipped as a duplicate', () => {
  const coverage = createCallCoverage([callKey(TEAMS_LINK, AT)]);
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: null, series_id: null },
      { optedOut: new Set(), ignoredKeys: new Set(), coverage },
    ),
    'skip_duplicate',
  );
});

test('decideDispatch: opt-out is checked before the join-link and dedupe gates', () => {
  // An opted-out lead is skipped even when the call is otherwise dispatchable.
  const coverage = createCallCoverage();
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: 'lead-9', series_id: null },
      { optedOut: new Set(['lead-9']), ignoredKeys: new Set(), coverage },
    ),
    'skip_opted_out',
  );
});

/*
 * Ghost-meeting "don't record" ignore list. Staff mark a stale/duplicate recurring
 * entry to skip; the sweep honours it by series_id (all occurrences) OR join link.
 */

test('isMeetingIgnored: matches on series_id (every occurrence) or join link, else false', () => {
  const bySeries = new Set(['series-xyz']);
  assert.equal(isMeetingIgnored({ series_id: 'series-xyz', video_link: TEAMS_LINK }, bySeries), true);
  assert.equal(isMeetingIgnored({ series_id: 'other', video_link: TEAMS_LINK }, bySeries), false);

  const byLink = new Set([TEAMS_LINK]);
  assert.equal(isMeetingIgnored({ series_id: null, video_link: TEAMS_LINK }, byLink), true);
  assert.equal(isMeetingIgnored({ series_id: null, video_link: 'https://other' }, byLink), false);

  // Empty/absent keys never accidentally match an empty-string list entry.
  assert.equal(isMeetingIgnored({ series_id: '', video_link: null }, new Set([''])), false);
  assert.equal(isMeetingIgnored({ series_id: null, video_link: TEAMS_LINK }, new Set()), false);
});

test('decideDispatch: an ignored series is skipped, and BEFORE the duplicate gate', () => {
  // Even a call already covered by a bot resolves to skip_ignored (ignore wins).
  const coverage = createCallCoverage([callKey(TEAMS_LINK, AT)]);
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: null, series_id: 'series-ghost' },
      { optedOut: new Set(), ignoredKeys: new Set(['series-ghost']), coverage },
    ),
    'skip_ignored',
  );
});

test('decideDispatch: an ignored one-off (no series) is skipped by its join link', () => {
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: null, series_id: null },
      { optedOut: new Set(), ignoredKeys: new Set([TEAMS_LINK]), coverage: createCallCoverage() },
    ),
    'skip_ignored',
  );
});

test('decideDispatch: opt-out still wins over the ignore list', () => {
  assert.equal(
    decideDispatch(
      { video_link: TEAMS_LINK, date_time: AT, meeting_lead_user_id: 'lead-1', series_id: 'series-ghost' },
      { optedOut: new Set(['lead-1']), ignoredKeys: new Set(['series-ghost']), coverage: createCallCoverage() },
    ),
    'skip_opted_out',
  );
});
