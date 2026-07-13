/**
 * Automation schedule tests (P8.1). Covers the PURE schedule contract shared by the
 * web agentic layer, the API routes, and the worker engine:
 *   - the configurable interval floor (default hourly; a lower policy floor is honoured
 *     but never below the absolute ~5-min structural floor),
 *   - the `before_meeting` EVENT trigger — parse/validate, non-scheduling (firstRunAt /
 *     nextRunAfter → null), and its human-readable description,
 *   - defensive rejection of malformed schedules.
 *
 * Pure — no DB or network. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ABSOLUTE_MIN_INTERVAL_MINUTES,
  DEFAULT_MIN_INTERVAL_MINUTES,
  describeSchedule,
  firstRunAt,
  isEventSchedule,
  nextRunAfter,
  parseSchedule,
} from '@gracie/shared';

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

test('interval floor: hourly default rejects sub-hourly, accepts ≥ floor', () => {
  const below = parseSchedule({ kind: 'interval', everyMinutes: 30 }, DEFAULT_MIN_INTERVAL_MINUTES);
  assert.ok('error' in below, 'sub-hourly should be rejected at the default floor');

  const ok = parseSchedule({ kind: 'interval', everyMinutes: 60 }, DEFAULT_MIN_INTERVAL_MINUTES);
  assert.ok('schedule' in ok);
});

test('interval floor: a lowered policy floor (30) permits 30m but never below the structural floor', () => {
  const ok = parseSchedule({ kind: 'interval', everyMinutes: 30 }, 30);
  assert.ok('schedule' in ok, '30m allowed when the floor is tuned to 30');

  // A mis-set floor below the structural minimum is clamped up — per-minute stays impossible.
  const perMinute = parseSchedule({ kind: 'interval', everyMinutes: 1 }, 1);
  assert.ok('error' in perMinute);
  assert.match(perMinute.error, new RegExp(String(ABSOLUTE_MIN_INTERVAL_MINUTES)));
});

test('before_meeting event: parses filters + clientId, and does not schedule a next_run_at', () => {
  const parsed = parseSchedule({
    kind: 'event',
    event: 'before_meeting',
    leadMinutes: 15,
    filters: { meetingsILead: true, clientId: CLIENT_ID },
    clientName: 'Acme',
  });
  assert.ok('schedule' in parsed);
  const s = parsed.schedule;
  assert.ok(isEventSchedule(s));
  if (s.kind !== 'event') throw new Error('unreachable');
  assert.equal(s.leadMinutes, 15);
  assert.equal(s.filters.meetingsILead, true);
  assert.equal(s.filters.clientId, CLIENT_ID);

  // Event triggers are not scheduled by next_run_at.
  const now = new Date('2026-07-13T12:00:00Z');
  assert.equal(firstRunAt(s, now), null);
  assert.equal(nextRunAfter(s, now), null);
});

test('before_meeting event: rejects a bad event name and out-of-range leadMinutes', () => {
  assert.ok('error' in parseSchedule({ kind: 'event', event: 'nope', leadMinutes: 15, filters: {} }));
  assert.ok('error' in parseSchedule({ kind: 'event', event: 'before_meeting', leadMinutes: 0, filters: {} }));
  // Above the 240-minute (4h) upper bound → rejected; exactly 240 → accepted.
  assert.ok('error' in parseSchedule({ kind: 'event', event: 'before_meeting', leadMinutes: 300, filters: {} }));
  assert.ok('schedule' in parseSchedule({ kind: 'event', event: 'before_meeting', leadMinutes: 240, filters: {} }));
});

test('before_meeting event: a non-UUID clientId is dropped, not trusted', () => {
  const parsed = parseSchedule({
    kind: 'event',
    event: 'before_meeting',
    leadMinutes: 30,
    filters: { clientId: 'Acme Corp' },
  });
  assert.ok('schedule' in parsed);
  if (parsed.schedule.kind !== 'event') throw new Error('unreachable');
  assert.equal(parsed.schedule.filters.clientId, undefined);
});

test('describeSchedule: event triggers read as a trigger, not a schedule', () => {
  const client = parseSchedule({ kind: 'event', event: 'before_meeting', leadMinutes: 15, filters: {} });
  assert.ok('schedule' in client);
  assert.equal(describeSchedule(client.schedule), '15 min before each client meeting');

  const lead = parseSchedule({
    kind: 'event',
    event: 'before_meeting',
    leadMinutes: 60,
    filters: { meetingsILead: true, clientId: CLIENT_ID },
    clientName: 'Acme',
  });
  assert.ok('schedule' in lead);
  assert.equal(describeSchedule(lead.schedule), '1 hr before each Acme meeting you lead');
});
