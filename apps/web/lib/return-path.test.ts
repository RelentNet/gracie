import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeReturnPath } from './return-path';

test('safeReturnPath keeps in-app paths, including query strings', () => {
  assert.equal(safeReturnPath('/pipeline'), '/pipeline');
  assert.equal(safeReturnPath('/clients/abc?tab=operations'), '/clients/abc?tab=operations');
});

test('safeReturnPath rejects anything that could leave the app or loop through auth', () => {
  const tab = String.fromCharCode(9);
  for (const bad of [
    null,
    undefined,
    '',
    'https://evil.example/x',
    '//evil.example/x',
    '/\\evil.example',
    'pipeline',
    `/${tab}/evil.example`,
    '/login',
    '/sign-in?returnTo=/x',
    '/callback',
  ]) {
    assert.equal(safeReturnPath(bad), null, String(bad));
  }
});
