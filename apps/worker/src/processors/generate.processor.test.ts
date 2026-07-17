/**
 * Generation storage-key tests (fix/meeting-folder-collision). Covers the PURE,
 * deterministic key derivation that files a meeting's generated docs + transcript
 * into MinIO. The bug these guard against: two meetings for one client on one day
 * shared date-only keys and silently overwrote each other's objects.
 *
 * Invariants proven here:
 *   - two same-client / same-ET-day meetings → DISTINCT folder, object, and
 *     transcript keys (no overwrite),
 *   - a re-run of the SAME meeting → IDENTICAL keys (idempotent; derived from
 *     meeting.date_time + meeting.id, never wall-clock now()),
 *   - keys are ET-based (a late-evening-UTC instant lands on the correct ET day/time),
 *   - title/id shape the names as specified (display label + `untitled`/`Meeting`
 *     fallbacks).
 *
 * Pure — no DB or network. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMeetingStorageKeys } from './generate.processor.js';

const SLUG = 'grace-associates';

test('two same-client, same-ET-day meetings get DISTINCT folders + object + transcript keys', () => {
  // Same client, same ET calendar day — the exact collision the old code hit.
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

  assert.notEqual(a.folderPath, b.folderPath, 'folder paths must differ');
  assert.notEqual(a.transcriptKey, b.transcriptKey, 'transcript keys must differ');
  assert.notEqual(
    a.objectKey('post_meeting_analysis.md'),
    b.objectKey('post_meeting_analysis.md'),
    'object keys for the same doc type must differ',
  );
  // Each doc key is nested under that meeting's own unique folder.
  assert.ok(a.objectKey('internal_memo.md').startsWith(`${a.folderPath}/`));
  assert.ok(b.objectKey('internal_memo.md').startsWith(`${b.folderPath}/`));
});

test('even identical title + minute collide-proof via the meeting-id suffix', () => {
  // Pathological: same title, same ET minute — only meeting.id disambiguates.
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
  assert.notEqual(a.folderPath, b.folderPath);
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

  assert.equal(first.folderPath, second.folderPath);
  assert.equal(first.folderDisplayName, second.folderDisplayName);
  assert.equal(first.transcriptKey, second.transcriptKey);
  assert.equal(first.objectKey('client_summary.md'), second.objectKey('client_summary.md'));
});

test('keys + display name are ET-stamped (14:30 UTC → 10:30 EDT)', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z', // 10:30 America/New_York (EDT)
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
  });
  assert.equal(k.stamp, '20260716-1030');
  assert.equal(k.folderPath, `clients/${SLUG}/generated/20260716-1030-kickoff-call-aaaaaaaa`);
  assert.equal(k.folderDisplayName, 'Kickoff Call 20260716-1030');
  assert.equal(k.transcriptKey, `clients/${SLUG}/transcripts/20260716-1030-aaaaaaaa.txt`);
  assert.equal(k.objectKey('internal_memo.md'), `${k.folderPath}/internal_memo.md`);
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
  assert.ok(k.folderPath.includes('/generated/20260716-2130-'));
});

test('title fallbacks: null title → `untitled` slug + `Meeting` label', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'dddddddd-1111-2222-3333-444444444444',
    title: null,
    slug: SLUG,
  });
  assert.equal(k.folderPath, `clients/${SLUG}/generated/20260716-1030-untitled-dddddddd`);
  assert.equal(k.folderDisplayName, 'Meeting 20260716-1030');
});
