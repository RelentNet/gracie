/**
 * Screen-share stills pure-logic tests. The ffmpeg spawn itself needs a real recording
 * (e2e gap, noted in the PR); these pin the parseable/selectable bits it depends on:
 *   - `parseSceneTimestamps` pulls `pts_time` values from ffmpeg's showinfo stderr, in order.
 *   - `selectStills` caps to N keeping first + last (a late slide is never dropped).
 *
 * Pure/no I/O. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSceneTimestamps, selectStills } from './stills.js';

test('parseSceneTimestamps: pulls pts_time values in order, ignoring other showinfo fields', () => {
  const stderr = [
    "[Parsed_showinfo_1 @ 0x1] n:0 pts:12000 pts_time:12 pos:1 fmt:yuvj420p",
    "[Parsed_showinfo_1 @ 0x1] n:1 pts:45500 pts_time:45.5 pos:2 fmt:yuvj420p",
    "[Parsed_showinfo_1 @ 0x1] n:2 pts:120250 pts_time:120.25 pos:3 fmt:yuvj420p",
  ].join('\n');
  assert.deepEqual(parseSceneTimestamps(stderr), [12, 45.5, 120.25]);
});

test('parseSceneTimestamps: no matches → empty (e.g. nobody screen-shared)', () => {
  assert.deepEqual(parseSceneTimestamps('ffmpeg version 5.1\nno frames selected\n'), []);
});

test('selectStills: returns all when within the cap', () => {
  assert.deepEqual(selectStills([1, 2, 3], 30), [1, 2, 3]);
  assert.deepEqual(selectStills([], 30), []);
});

test('selectStills: caps to N, evenly spaced, always keeping first and last', () => {
  const all = Array.from({ length: 100 }, (_, i) => i);
  const picked = selectStills(all, 5);
  assert.equal(picked.length, 5);
  assert.equal(picked[0], 0); // first kept
  assert.equal(picked[picked.length - 1], 99); // last kept — a late slide survives
  // Strictly increasing (no dupes) and within bounds.
  for (let i = 1; i < picked.length; i += 1) {
    assert.ok((picked[i] as number) > (picked[i - 1] as number));
  }
});

test('selectStills: max 0 → empty', () => {
  assert.deepEqual(selectStills([1, 2, 3], 0), []);
});
