/**
 * Consent allow-list self-checks. Pure — no HTTP, no DB.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addToAllowlist,
  applyConsent,
  isConsented,
  normalizeMailbox,
  parseConsentList,
  removeFromAllowlist,
  serializeConsentList,
} from './contact-import-consent';

test('missing / empty / corrupt store ⇒ default deny (empty list)', () => {
  for (const raw of [null, undefined, '', '   ', 'not json', '{}', '42', '"joe@x.com"']) {
    assert.deepEqual(parseConsentList(raw), []);
  }
});

test('parse normalizes case, trims, dedupes, and drops non-emails', () => {
  const raw = JSON.stringify(['  Joe@GA.com ', 'joe@ga.com', 'bad', '', 'ann@ga.com']);
  assert.deepEqual(parseConsentList(raw), ['joe@ga.com', 'ann@ga.com']);
});

test('isConsented is case-insensitive and robust to an un-normalized list', () => {
  assert.equal(isConsented('JOE@ga.com', ['joe@ga.com']), true);
  assert.equal(isConsented('joe@ga.com', ['JOE@GA.com']), true); // list not pre-normalized
  assert.equal(isConsented('nobody@ga.com', ['joe@ga.com']), false);
  assert.equal(isConsented('  ', ['joe@ga.com']), false);
});

test('add is idempotent and case-folding; remove is case-insensitive', () => {
  const once = addToAllowlist([], 'Joe@GA.com');
  assert.deepEqual(once, ['joe@ga.com']);
  assert.deepEqual(addToAllowlist(once, 'joe@ga.com'), ['joe@ga.com']); // no dup
  assert.deepEqual(removeFromAllowlist(once, 'JOE@ga.com'), []); // case-insensitive removal
});

test('serialize round-trips through parse (normalized)', () => {
  const value = serializeConsentList(['A@x.com', 'a@x.com', 'B@x.com']);
  assert.deepEqual(parseConsentList(value), ['a@x.com', 'b@x.com']);
});

test('self-serve write is self-scoped: only the session email ever changes', () => {
  const others = ['ann@ga.com', 'bob@ga.com'];
  const me = 'me@ga.com';

  // Opting myself in leaves everyone else exactly as they were, adds only me.
  const opted = applyConsent(others, me, true);
  assert.deepEqual(opted, ['ann@ga.com', 'bob@ga.com', 'me@ga.com']);

  // Opting myself out removes only me — never a sibling.
  const optedOut = applyConsent(opted, me, false);
  assert.deepEqual(optedOut, others);

  // Even a mixed-case session email touches only my own entry.
  const list = ['ann@ga.com', 'me@ga.com', 'bob@ga.com'];
  assert.deepEqual(applyConsent(list, 'ME@GA.com', false), ['ann@ga.com', 'bob@ga.com']);
});

test('normalizeMailbox trims + lower-cases', () => {
  assert.equal(normalizeMailbox('  Joe@GA.COM '), 'joe@ga.com');
});
