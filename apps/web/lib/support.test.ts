import assert from 'node:assert/strict';
import { test } from 'node:test';

import { browserName, describeScreen, isSupportCategory } from './support';

test('describeScreen reports window, zoom and physical screen (Scott: 1920×1200 at 150%)', () => {
  assert.equal(
    describeScreen({ innerWidth: 1280, innerHeight: 660, devicePixelRatio: 1.5, screenWidth: 1280, screenHeight: 800 }),
    '1280×660 window · 150% zoom · 1920×1200 screen',
  );
});

test('browserName recognises the browsers staff actually use', () => {
  const edge = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
  const ddg = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 DuckDuckGo/5';
  const safari = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  assert.equal(browserName(edge), 'Edge');
  assert.equal(browserName(chrome), 'Chrome');
  assert.equal(browserName(ddg), 'DuckDuckGo');
  assert.equal(browserName(safari), 'Safari');
});

test('isSupportCategory only accepts the three categories', () => {
  assert.equal(isSupportCategory('problem'), true);
  assert.equal(isSupportCategory('cant_do'), true);
  assert.equal(isSupportCategory('idea'), true);
  assert.equal(isSupportCategory('other'), false);
  assert.equal(isSupportCategory(undefined), false);
});
