/**
 * clientLogoSrc self-checks. Pure — no HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clientLogoSrc } from './client-display';

test('no logo key → null (initials fallback)', () => {
  assert.equal(clientLogoSrc('c1', null), null);
  assert.equal(clientLogoSrc('c1', ''), null);
});

test('logo key → same-origin proxy URL with a ?v cache-buster', () => {
  const src = clientLogoSrc('abc', 'clients/abc/logo-123.png');
  assert.equal(src, '/api/clients/abc/logo?v=clients%2Fabc%2Flogo-123.png');
});
