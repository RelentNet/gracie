/**
 * Generation storage-key tests (fix/meeting-folder-collision + series grouping).
 * Covers the PURE, deterministic key derivation that files a meeting's generated
 * docs + transcript into MinIO. The bug these guard against: two meetings for one
 * client on one day shared date-only keys and silently overwrote each other.
 *
 * Layout under test (series group → occurrence subfolder → files):
 *   clients/<slug>/generated/<group>/<stamp>-<id8>/<type>.md
 * where <group> = `series-<hash>` when the meeting recurs (stable series_id), else
 * the title slug (one-offs).
 *
 * Invariants proven here:
 *   - two same-client / same-ET-day meetings → DISTINCT occurrence + object +
 *     transcript keys (no overwrite),
 *   - a recurring series (same series_id) shares ONE group folder even when the
 *     per-occurrence TITLE differs (title-proof), and two DISTINCT series that
 *     share a title get DIFFERENT group folders (correctly split),
 *   - one-offs (series_id null) fall back to grouping by title slug,
 *   - a re-run of the SAME meeting → IDENTICAL keys (idempotent; derived from
 *     meeting.date_time + meeting.id, never wall-clock now()),
 *   - keys are ET-based (a late-evening-UTC instant lands on the correct ET day/time).
 *
 * Pure — no DB or network. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stripReproducedScaffold } from '../lib/generate.js';
import { buildDigest, buildMeetingStorageKeys } from './generate.processor.js';

const SLUG = 'grace-associates';
// Two distinct "clean GOID" series keys (shape mirrors migration 0011 output).
const SERIES_A = '040000008200E00074C5B7101A82E0080000000010FB42DA6CBDD80100000000000000001AAAA';
const SERIES_B = '040000008200E00074C5B7101A82E00800000000A0382DA4E9D3DC0100000000000000001BBBB';

test('two same-client, same-ET-day meetings get DISTINCT occurrence + object + transcript keys', () => {
  const a = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
    seriesId: null,
  });
  const b = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T18:00:00Z',
    meetingId: 'bbbbbbbb-5555-6666-7777-888888888888',
    title: 'Status Review',
    slug: SLUG,
    seriesId: null,
  });

  assert.notEqual(a.occurrenceFolderPath, b.occurrenceFolderPath, 'occurrence folders must differ');
  assert.notEqual(a.transcriptKey, b.transcriptKey, 'transcript keys must differ');
  assert.notEqual(
    a.objectKey('post_meeting_analysis.md'),
    b.objectKey('post_meeting_analysis.md'),
    'object keys for the same doc type must differ',
  );
  assert.ok(a.objectKey('internal_memo.md').startsWith(`${a.occurrenceFolderPath}/`));
  assert.ok(b.objectKey('internal_memo.md').startsWith(`${b.occurrenceFolderPath}/`));
});

test('recurring series: same series_id shares ONE group folder even if titles differ', () => {
  // Two occurrences of one series; the second occurrence's title was edited. The
  // whole point of keying the group off series_id: they still nest together.
  const wk1 = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-06T15:00:00Z',
    meetingId: 'aaaaaaaa-0000-0000-0000-000000000000',
    title: 'Weekly Standup',
    slug: SLUG,
    seriesId: SERIES_A,
  });
  const wk2 = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-13T15:00:00Z',
    meetingId: 'bbbbbbbb-0000-0000-0000-000000000000',
    title: 'Weekly Standup (moved)', // title drifted
    slug: SLUG,
    seriesId: SERIES_A,
  });

  assert.equal(wk1.groupFolderPath, wk2.groupFolderPath, 'same series → same group folder');
  assert.match(wk1.groupFolderPath, new RegExp(`^clients/${SLUG}/generated/series-[0-9a-f]{12}$`));
  assert.notEqual(wk1.occurrenceFolderPath, wk2.occurrenceFolderPath, 'distinct occurrences');
  assert.notEqual(wk1.transcriptKey, wk2.transcriptKey);
  assert.notEqual(wk1.objectKey('client_summary.md'), wk2.objectKey('client_summary.md'));
});

test('two DISTINCT series that share a title get DIFFERENT group folders (split, not merged)', () => {
  const s1 = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-06T15:00:00Z',
    meetingId: 'aaaaaaaa-0000-0000-0000-000000000000',
    title: 'Allie & Daniel',
    slug: SLUG,
    seriesId: SERIES_A,
  });
  const s2 = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-06T16:00:00Z',
    meetingId: 'bbbbbbbb-0000-0000-0000-000000000000',
    title: 'Allie & Daniel', // same title, different series
    slug: SLUG,
    seriesId: SERIES_B,
  });
  assert.notEqual(s1.groupFolderPath, s2.groupFolderPath, 'different series → different groups');
});

test('one-off (series_id null) falls back to grouping by title slug', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
    seriesId: null,
  });
  assert.equal(k.groupFolderPath, `clients/${SLUG}/generated/kickoff-call`);
});

test('same series + same ET minute still collide-proof via the meeting-id suffix', () => {
  const a = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'aaaaaaaa-0000-0000-0000-000000000000',
    title: 'Kickoff Call',
    slug: SLUG,
    seriesId: SERIES_A,
  });
  const b = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'bbbbbbbb-0000-0000-0000-000000000000',
    title: 'Kickoff Call',
    slug: SLUG,
    seriesId: SERIES_A,
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
    seriesId: SERIES_A,
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

test('keys + labels are ET-stamped (14:30 UTC → 10:30 EDT); group label is the title', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z', // 10:30 America/New_York (EDT)
    meetingId: 'aaaaaaaa-1111-2222-3333-444444444444',
    title: 'Kickoff Call',
    slug: SLUG,
    seriesId: null,
  });
  assert.equal(k.stamp, '20260716-1030');
  assert.equal(k.groupDisplayName, 'Kickoff Call');
  assert.equal(k.occurrenceFolderPath, `${k.groupFolderPath}/20260716-1030-aaaaaaaa`);
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
    seriesId: null,
  });
  assert.equal(k.stamp, '20260716-2130');
  assert.equal(k.occurrenceDisplayName, '2026-07-16 21:30');
  assert.ok(k.occurrenceFolderPath.endsWith('/20260716-2130-cccccccc'));
});

test('title fallbacks: null title + null series → `untitled` group slug + `Meeting` label', () => {
  const k = buildMeetingStorageKeys({
    dateTimeIso: '2026-07-16T14:30:00Z',
    meetingId: 'dddddddd-1111-2222-3333-444444444444',
    title: null,
    slug: SLUG,
    seriesId: null,
  });
  assert.equal(k.groupFolderPath, `clients/${SLUG}/generated/untitled`);
  assert.equal(k.groupDisplayName, 'Meeting');
  assert.equal(k.occurrenceFolderPath, `clients/${SLUG}/generated/untitled/20260716-1030-dddddddd`);
});

/*
 * Reproduced-scaffold stripping (fix/master-record-summary). Editable prompts (#60)
 * lead with a `# ... Prompt Template` heading + a fenced YAML metadata block; the
 * model copied that verbatim to the top of the generated doc, so the doc AND the
 * master-record digest derived from it began with a raw YAML dump. These pin that a
 * reproduced leading scaffold is removed while genuine content is left untouched.
 */

// Mirrors the real bad output: reproduced template front-matter, then the real body.
const REPRODUCED_ANALYSIS = [
  '# GA Prompt Template: Post-Meeting Analysis & Action Plan',
  '',
  '```yaml',
  'template_id: post_meeting_analysis',
  'output_filename: post_meeting_analysis.md',
  'audience: internal (GA team)',
  'run_order: 1',
  '```',
  '',
  '# Meeting Analysis & Action Plan',
  '',
  '## BLUF',
  'The team agreed to pursue the Leap Metrics pilot; Joe to schedule the intro by 8/4.',
].join('\n');

test('stripReproducedScaffold: removes a reproduced heading + YAML front-matter block', () => {
  const out = stripReproducedScaffold(REPRODUCED_ANALYSIS);
  assert.ok(out.startsWith('# Meeting Analysis & Action Plan'), 'body must start at real content');
  assert.ok(!out.includes('```yaml'), 'the fenced yaml block must be gone');
  assert.ok(!out.includes('template_id:'), 'the metadata must be gone');
});

test('buildDigest on a scaffold-stripped analysis is readable prose, not a YAML dump', () => {
  const digest = buildDigest(stripReproducedScaffold(REPRODUCED_ANALYSIS));
  assert.ok(digest.startsWith('Meeting Analysis & Action Plan'), 'digest reads as prose');
  assert.ok(!digest.includes('```yaml') && !digest.includes('template_id:'), 'no scaffold leaked');
  // Regression: the shipped bug stored exactly this raw-YAML head.
  assert.ok(!digest.startsWith('```yaml template_id'), 'must not be the raw template dump');
});

test('stripReproducedScaffold: strips a metadata fence even with no leading heading', () => {
  const raw = ['```yaml', 'template_id: internal_memo', '```', '', 'Real memo body here.'].join('\n');
  assert.equal(stripReproducedScaffold(raw), 'Real memo body here.');
});

test('stripReproducedScaffold: leaves genuine content untouched (no scaffold)', () => {
  const clean = '# Internal Post-Meeting Analysis\n\n## BLUF\nWe agreed to ship on Friday.';
  assert.equal(stripReproducedScaffold(clean), clean);
});

test('stripReproducedScaffold: preserves a YAML block that follows real prose', () => {
  const doc = '# Analysis\n\nThe config discussed was:\n\n```yaml\nkey: value\n```\n';
  assert.equal(stripReproducedScaffold(doc), doc);
});

test('stripReproducedScaffold: leaves a JSON checklist and a non-metadata leading fence alone', () => {
  assert.equal(stripReproducedScaffold('{"tasks":[]}'), '{"tasks":[]}');
  const jsonFence = '```json\n{"a":1}\n```\n\nrest';
  assert.equal(stripReproducedScaffold(jsonFence), jsonFence);
});
