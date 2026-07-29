/**
 * File-preview parsing self-checks. Pure — no HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sanitizePreviewHtml } from '@gracie/shared/extract';

import { parseCsv } from './csv';

test('parseCsv handles quoted fields with embedded commas, newlines and escaped quotes', () => {
  const csv = 'a,b,c\r\n"x,y","line1\nline2","he said ""hi"""\n';
  assert.deepEqual(parseCsv(csv), [
    ['a', 'b', 'c'],
    ['x,y', 'line1\nline2', 'he said "hi"'],
  ]);
});

test('parseCsv keeps empty trailing cells and skips a phantom final row', () => {
  assert.deepEqual(parseCsv('1,,3\n'), [['1', '', '3']]);
});

test('sanitizePreviewHtml strips scripts, styles, on* handlers and javascript: urls', () => {
  const dirty =
    '<p onclick="steal()">hi</p><script>evil()</script><style>x{}</style>' +
    '<a href="javascript:alert(1)">x</a><strong>keep</strong>';
  const clean = sanitizePreviewHtml(dirty);
  assert.ok(!/onclick/i.test(clean), 'event handler removed');
  assert.ok(!/<script/i.test(clean), 'script block removed');
  assert.ok(!/<style/i.test(clean), 'style block removed');
  assert.ok(!/javascript:/i.test(clean), 'javascript: url neutralized');
  assert.ok(/<strong>keep<\/strong>/.test(clean), 'benign markup preserved');
});
