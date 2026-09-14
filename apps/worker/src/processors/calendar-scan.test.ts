/**
 * Private-event rule (2026-09-14). A meeting marked Private in Outlook on ANY
 * attendee's calendar is never ingested — hidden from Gracie and never joined by a
 * bot — while normal meetings (including same-looking internal 1:1s) still are.
 *
 * Pure: exercises `aggregateCalendarEvents`; no DB/network.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GraphEvent } from '../lib/graph.js';
import { aggregateCalendarEvents } from './calendar-scan.processor.js';

function ev(over: Partial<GraphEvent> & { readonly iCalUId: string }): GraphEvent {
  return {
    id: `id-${over.iCalUId}`,
    subject: 'Meeting',
    startUtc: '2026-09-10T15:00:00.000Z',
    endUtc: '2026-09-10T16:00:00.000Z',
    isCancelled: false,
    isPrivate: false,
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
    organizerEmail: 'cwallace@graceandassociates.com',
    attendees: [
      { email: 'cwallace@graceandassociates.com', type: 'required', name: null },
      { email: 'agrace@graceandassociates.com', type: 'required', name: null },
    ],
    ...over,
  };
}

test('a private event is dropped; a normal one next to it is kept', () => {
  const { aggregated, eventCount } = aggregateCalendarEvents([
    { email: 'cwallace@graceandassociates.com', events: [ev({ iCalUId: 'appt', isPrivate: true }), ev({ iCalUId: 'allie' })] },
  ]);
  assert.deepEqual([...aggregated.values()].map((m) => m.canonical.iCalUId), ['allie']);
  assert.equal(eventCount, 1);
});

test('private on ANY copy drops the whole meeting, whichever calendar is read first', () => {
  for (const order of [[false, true], [true, false]] as const) {
    const { aggregated } = aggregateCalendarEvents([
      { email: 'a@graceandassociates.com', events: [ev({ iCalUId: 'm', isPrivate: order[0] })] },
      { email: 'b@graceandassociates.com', events: [ev({ iCalUId: 'm', isPrivate: order[1] })] },
    ]);
    assert.equal(aggregated.size, 0);
  }
});

test('a normal meeting seen on two calendars merges into one with both owners', () => {
  const { aggregated } = aggregateCalendarEvents([
    { email: 'a@graceandassociates.com', events: [ev({ iCalUId: 'm' })] },
    { email: 'b@graceandassociates.com', events: [ev({ iCalUId: 'm' })] },
  ]);
  assert.equal(aggregated.size, 1);
  assert.deepEqual([...[...aggregated.values()][0]!.ownerEmails].sort(), ['a@graceandassociates.com', 'b@graceandassociates.com']);
});
