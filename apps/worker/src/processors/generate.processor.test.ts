/**
 * Generation storage-key tests (fix/meeting-folder-collision). Covers the PURE,
 * deterministic key derivation that files a meeting's generated docs + transcript
 * into MinIO. The bug these guard against: two meetings for one client on one day
 * shared date-only keys and silently overwrote each other's objects.
 *
 * Layout under test (series group → occurrence subfolder → files):
 *   clients/<slug>/generated/<titleSlug>/<stamp>-<id8>/<type>.md
 *
 * Invariants proven here:
 *   - two same-client / same-ET-day meetings → DISTINCT occurrence folders +
 *     object + transcript keys (no overwrite),
 *   - recurring meetings (SAME title) share ONE group folder but get DISTINCT
 *     occurrence folders/keys (grouped, still collision-safe),
 *   - a re-run of the SAME meeting → IDENTICAL keys (idempotent; derived from
 *     meeting.date_time + meeting.id, never wall-clock now()),
 *   - keys are ET-based (a late-evening-UTC instant lands on the correct ET day/time),
 *   - title/id shape the names as specified (labels + `untitled`/`Meeting` fallbacks).
 *
 * Pure — no DB or network. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMeetingStorageKeys } from './generate.processor.js';

const SLUG = 'grace-associates';

test('two same-client, same-ET-day meetings get DISTINCT occurrence + object + transcript keys', () => {
  const a = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
  });
  const b = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T18:00:00Z',
    meetingId: 'bbbbbbbb-5555-6666-7777-888888888888',
    title: 'Status Review',
    slug: SLUG,
  });

  assert.notEqual(a.occurrenceFolderPath, b.occurrenceFolderPath, 'occurrence folders must differ');
  assert.notEqual(a.transcriptKey, b.transcriptKey, 'transcript keys must differ');
  assert.notEqual(
    a.objectKey('post_meeting_analysis.md'),
    b.objectKey('post_meeting_analysis.md'),
    'object keys for the same doc type must differ',
  );
  // Each doc key is nested under that meeting's own unique occurrence folder.
  assert.ok(a.objectKey('internal_memo.md').startsWith(`${a.occurrenceFolderPath}/`));
  assert.ok(b.objectKey('internal_memo.md').startsWith(`${b.occurrenceFolderPath}/`));
});

test('recurring meetings (SAME title) share ONE group folder but DISTINCT occurrences', () => {
  // Two occurrences of a weekly series — same title, different days. The whole
  // point of the grouped scheme: they land under one "Weekly Standup" folder yet
  // never overwrite each other.
  const wk1 = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-06T15:00:00Z',
    meetingId: 'aaaaaaaa-0000-0000-0000-000000000000',
    title: 'Weekly Standup',
    slug: SLUG,
  });
  const wk2 = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-13T15:00:00Z',
    meetingId: 'bbbbbbbb-0000-0000-0000-000000000000',
    title: 'Weekly Standup',
    slug: SLUG,
  });

  assert.equal(wk1.groupFolderPath, wk2.groupFolderPath, 'same title → same group folder');
  assert.equal(wk1.groupFolderPath, `clients/${SLUG}/generated/weekly-standup`);
  assert.notEqual(wk1.occurrenceFolderPath, wk2.occurrenceFolderPath, 'different occurrences');
  assert.notEqual(wk1.transcriptKey, wk2.transcriptKey);
  assert.notEqual(wk1.objectKey('client_summary.md'), wk2.objectKey('client_summary.md'));
});

test('same title + same ET minute still collide-proof via the meeting-id suffix', () => {
  const a = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'aaaaaaaa-0000-0000-0000-000000000000',
    title: 'Kickoff Call',
    slug: SLUG,
  });
  const b = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'bbbbbbbb-0000-0000-0000-000000000000',
    title: 'Kickoff Call',
    slug: SLUG,
  });
  assert.equal(a.groupFolderPath, b.groupFolderPath);
  assert.notEqual(a.occurrenceFolderPath, b.occurrenceFolderPath);
  assert.notEqual(a.transcriptKey, b.transcriptKey);
});

test('re-run of the SAME meeting resolves IDENTICAL keys (deterministic / idempotent)', () => {
  const input = {
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
  } as const;
  const first = buildMeetingStorageKeys(input);
  const second = buildMeetingStorageKeys(input);

  assert.deepEqual(
    {
      g: first.groupFolderPath,
      gd: first.groupDisplayName,
      o: first.occurrenceFolderPath,
      od: first.occurrenceDisplayName,
      t: first.transcriptKey,
      k: first.objectKey('client_summary.md'),
    },
    {
      g: second.groupFolderPath,
      gd: second.groupDisplayName,
      o: second.occurrenceFolderPath,
      od: second.occurrenceDisplayName,
      t: second.transcriptKey,
      k: second.objectKey('client_summary.md'),
    },
  );
});

test('keys + labels are ET-stamped (14:30 UTC → 10:30 EDT)', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z', // 10:30 America/New_York (EDT)
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
  });
  assert.equal(k.stamp, '20260716-1030');
  assert.equal(k.groupFolderPath, `clients/${SLUG}/generated/kickoff-call`);
  assert.equal(k.groupDisplayName, 'Kickoff Call');
  assert.equal(k.occurrenceFolderPath, `clients/${SLUG}/generated/kickoff-call/20260716-1030-aaaaaaaa`);
  assert.equal(k.occurrenceDisplayName, '2026-07-16 10:30');
  assert.equal(k.transcriptKey, `clients/${SLUG}/transcripts/20260716-1030-aaaaaaaa.txt`);
  assert.equal(k.objectKey('internal_memo.md'), `${k.occurrenceFolderPath}/internal_memo.md`);
});

test('late-evening UTC lands on the correct ET day (not the UTC day)', () => {
  // 01:30 UTC on the 17th is 21:30 EDT on the 16th — the UTC `.slice(0,10)` bug
  // would have filed this under 2026-07-17; ET correctly keeps it on the 16th.
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-17T01:30:00Z',
    meetingId: 'cccccccc-1111-2222-3333-444444444444',
    title: 'Evening Sync',
    slug: SLUG,
  });
  assert.equal(k.stamp, '20260716-2130');
  assert.equal(k.occurrenceDisplayName, '2026-07-16 21:30');
  assert.ok(k.occurrenceFolderPath.endsWith('/20260716-2130-cccccccc'));
});

test('title fallbacks: null title → `untitled` group slug + `Meeting` label', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'dddddddd-1111-2222-3333-444444444444',
    title: null,
    slug: SLUG,
  });
  assert.equal(k.groupFolderPath, `clients/${SLUG}/generated/untitled`);
  assert.equal(k.groupDisplayName, 'Meeting');
  assert.equal(k.occurrenceFolderPath, `clients/${SLUG}/generated/untitled/20260716-1030-dddddddd`);
});
