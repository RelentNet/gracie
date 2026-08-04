/**
 * Self-checks for the chunked `.in(...)` helper. Pure — no HTTP, no DB. The fake
 * `queryChunk` records each batch it receives so we can assert batch boundaries and
 * the merge. Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectByIdsChunked } from './chunked';

/** Build `n` fake ids ("id-0", "id-1", …). */
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `id-${i}`);
}

/**
 * A fake `queryChunk` that echoes each id back as a `{ id }` row and records the
 * size of every batch it was called with (so tests can assert batching).
 */
function recorder(): {
  queryChunk: (chunk: string[]) => Promise<{ data: { id: string }[] | null; error: null }>;
  batches: number[];
} {
  const batches: number[] = [];
  return {
    batches,
    queryChunk: (chunk) => {
      batches.push(chunk.length);
      return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
    },
  };
}

test('250 ids at chunkSize 100 → 3 batches [100,100,50], rows merged in order', async () => {
  const { queryChunk, batches } = recorder();
  const rows = await selectByIdsChunked('t', ids(250), queryChunk, 100);
  assert.deepEqual(batches, [100, 100, 50]);
  assert.equal(rows.length, 250);
  assert.deepEqual(
    rows.map((r) => r.id),
    ids(250),
  );
});

test('0 ids → no query issued, empty result', async () => {
  const { queryChunk, batches } = recorder();
  const rows = await selectByIdsChunked('t', [], queryChunk, 100);
  assert.deepEqual(batches, []);
  assert.deepEqual(rows, []);
});

test('exactly chunkSize → a single batch, no phantom empty batch', async () => {
  const { queryChunk, batches } = recorder();
  const rows = await selectByIdsChunked('t', ids(100), queryChunk, 100);
  assert.deepEqual(batches, [100]);
  assert.equal(rows.length, 100);
});

test('exact multiple of chunkSize → no trailing empty batch', async () => {
  const { queryChunk, batches } = recorder();
  const rows = await selectByIdsChunked('t', ids(200), queryChunk, 100);
  assert.deepEqual(batches, [100, 100]);
  assert.equal(rows.length, 200);
});

test('default chunkSize is 100', async () => {
  const { queryChunk, batches } = recorder();
  await selectByIdsChunked('t', ids(150), queryChunk);
  assert.deepEqual(batches, [100, 50]);
});

test('a chunk error aborts and throws with the label prefix', async () => {
  let calls = 0;
  const queryChunk = (chunk: string[]): Promise<{ data: { id: string }[] | null; error: { message: string } | null }> => {
    calls += 1;
    // Fail on the second batch to prove we surface mid-stream errors.
    if (calls === 2) return Promise.resolve({ data: null, error: { message: 'boom' } });
    return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
  };
  await assert.rejects(() => selectByIdsChunked('calendar.loadMeetingOrgs', ids(250), queryChunk, 100), {
    message: 'calendar.loadMeetingOrgs: boom',
  });
});
