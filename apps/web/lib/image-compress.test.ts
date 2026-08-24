/**
 * scaledDimensions self-checks. Pure — the canvas/encode path needs a browser,
 * so only the aspect-ratio math is exercised here. Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scaledDimensions } from './image-compress';

test('scaledDimensions caps the longest edge and preserves aspect ratio', () => {
  assert.deepEqual(scaledDimensions(1000, 500, 256), { w: 256, h: 128 });
  assert.deepEqual(scaledDimensions(500, 1000, 256), { w: 128, h: 256 });
});

test('scaledDimensions never upscales a source smaller than the cap', () => {
  assert.deepEqual(scaledDimensions(100, 40, 256), { w: 100, h: 40 });
});

test('scaledDimensions clamps to at least 1px and handles zero', () => {
  assert.deepEqual(scaledDimensions(4000, 1, 256), { w: 256, h: 1 });
  assert.deepEqual(scaledDimensions(0, 0, 256), { w: 0, h: 0 });
});
