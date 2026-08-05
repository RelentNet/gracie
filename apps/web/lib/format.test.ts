/**
 * Timezone resolution + formatting self-checks. Pure — no DOM, no DB.
 * Run with `pnpm --filter web test`.
 *
 * These run under Node (no `window`), so the "no explicit zone" path resolves to
 * the SSR/profile fallback (America/New_York) — exactly the server behavior.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatEasternDate,
  formatEasternDateTime,
  resolveTimeZone,
} from './format';

/** Collapse Intl's narrow no-break spaces so assertions are ICU-version stable. */
const norm = (s: string): string => s.replace(/\s+/g, ' ');

// 1 PM UTC on 2026-07-10 (summer → EDT/CDT in effect).
const INSTANT = '2026-07-10T13:00:00Z';

test('resolveTimeZone: explicit zone wins', () => {
  assert.equal(resolveTimeZone('Asia/Tokyo'), 'Asia/Tokyo');
});

test('resolveTimeZone: no/empty/null zone on the server falls back to America/New_York', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'America/New_York');
  assert.equal(resolveTimeZone(undefined), DEFAULT_TIME_ZONE);
  assert.equal(resolveTimeZone(null), DEFAULT_TIME_ZONE);
  assert.equal(resolveTimeZone(''), DEFAULT_TIME_ZONE);
});

test('formatDateTime: a UTC instant renders in the given zone', () => {
  assert.ok(norm(formatDateTime(INSTANT, 'America/New_York')).includes('9:00 AM')); // UTC-4
  assert.ok(norm(formatDateTime(INSTANT, 'America/Chicago')).includes('8:00 AM')); // UTC-5
  assert.ok(norm(formatDateTime(INSTANT, 'Asia/Tokyo')).includes('10:00 PM')); // UTC+9
  assert.ok(norm(formatDateTime(INSTANT, 'America/New_York')).includes('Jul 10, 2026'));
});

test('formatDateTime: no zone on the server falls back to Eastern (SSR default)', () => {
  assert.ok(norm(formatDateTime(INSTANT)).includes('9:00 AM'));
});

test('formatDate: renders the calendar date in the given zone (can cross the day boundary)', () => {
  // 1 PM UTC is still Jul 10 everywhere here…
  assert.ok(formatDate(INSTANT, 'America/New_York').includes('July 10, 2026'));
  // …but 2 AM UTC on the 11th is still the 10th in the US.
  assert.ok(formatDate('2026-07-11T02:00:00Z', 'America/Chicago').includes('July 10, 2026'));
});

test('formatEastern* are the same formatters (kept only as back-compat names)', () => {
  assert.equal(formatEasternDateTime, formatDateTime);
  assert.equal(formatEasternDate, formatDate);
  assert.ok(norm(formatEasternDateTime(INSTANT, 'Asia/Tokyo')).includes('10:00 PM'));
});

test('an unparseable instant renders empty (never "Invalid Date")', () => {
  assert.equal(formatDateTime('not-a-date', 'America/New_York'), '');
  assert.equal(formatDate('', 'America/New_York'), '');
});
