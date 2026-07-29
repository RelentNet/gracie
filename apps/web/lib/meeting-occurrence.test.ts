/**
 * Meeting-occurrence pure-logic self-checks. No DB, no HTTP.
 * Run with `pnpm --filter web test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveMeetingFleetState,
  deriveOccurrenceState,
  selectPriorMeetings,
} from './meeting-occurrence';

const NOW = new Date('2026-07-20T15:00:00Z');

/** A meeting that has not started yet is upcoming. */
test('future meeting → upcoming', () => {
  const state = deriveOccurrenceState(
    {
      dateTime: '2026-07-20T16:00:00Z',
      durationMinutes: 30,
      pipelineStatus: 'scheduled',
      isBotDispatched: true,
      isTranscriptReceived: false,
    },
    NOW,
  );
  assert.equal(state, 'upcoming');
});

test('inside the window with a bot dispatched → in_session', () => {
  const state = deriveOccurrenceState(
    {
      dateTime: '2026-07-20T14:45:00Z',
      durationMinutes: 30,
      pipelineStatus: 'scheduled',
      isBotDispatched: true,
      isTranscriptReceived: false,
    },
    NOW,
  );
  assert.equal(state, 'in_session');
});

test('inside the window but NO bot → still upcoming (not recording)', () => {
  const state = deriveOccurrenceState(
    {
      dateTime: '2026-07-20T14:45:00Z',
      durationMinutes: 30,
      pipelineStatus: 'scheduled',
      isBotDispatched: false,
      isTranscriptReceived: false,
    },
    NOW,
  );
  assert.equal(state, 'upcoming');
});

test('past the scheduled window → ended', () => {
  const state = deriveOccurrenceState(
    {
      dateTime: '2026-07-20T13:00:00Z',
      durationMinutes: 30,
      pipelineStatus: 'scheduled',
      isBotDispatched: true,
      isTranscriptReceived: false,
    },
    NOW,
  );
  assert.equal(state, 'ended');
});

test('recorded signals force ended even before the clock says so', () => {
  const base = {
    dateTime: '2026-07-20T16:00:00Z', // still in the future
    durationMinutes: 30,
    isBotDispatched: true,
  } as const;
  assert.equal(
    deriveOccurrenceState({ ...base, pipelineStatus: 'scheduled', isTranscriptReceived: true }, NOW),
    'ended',
  );
  for (const pipelineStatus of ['complete', 'needs_attention', 'awaiting_transcript', 'processing'] as const) {
    assert.equal(
      deriveOccurrenceState({ ...base, pipelineStatus, isTranscriptReceived: false }, NOW),
      'ended',
    );
  }
});

test('fleet state: a run wins; null run status = skip note', () => {
  assert.equal(
    deriveMeetingFleetState({ hasRun: true, runStatus: 'failed', pipelineStatus: 'needs_attention' }),
    'failed',
  );
  assert.equal(
    deriveMeetingFleetState({ hasRun: true, runStatus: null, pipelineStatus: 'complete' }),
    'skipped',
  );
});

test('fleet state: no run falls back to the meeting status', () => {
  assert.equal(deriveMeetingFleetState({ hasRun: false, runStatus: null, pipelineStatus: 'complete' }), 'success');
  assert.equal(
    deriveMeetingFleetState({ hasRun: false, runStatus: null, pipelineStatus: 'needs_attention' }),
    'needs_attention',
  );
  assert.equal(deriveMeetingFleetState({ hasRun: false, runStatus: null, pipelineStatus: 'cancelled' }), 'skipped');
  assert.equal(deriveMeetingFleetState({ hasRun: false, runStatus: null, pipelineStatus: 'processing' }), 'in_progress');
});

test('prior-meeting selection: excludes self, keeps earlier only, newest-first, capped', () => {
  const meetings = [
    { id: 'now', dateTime: '2026-07-20T16:00:00Z' },
    { id: 'a', dateTime: '2026-07-19T16:00:00Z' },
    { id: 'b', dateTime: '2026-07-10T16:00:00Z' },
    { id: 'c', dateTime: '2026-06-30T16:00:00Z' },
    { id: 'd', dateTime: '2026-06-01T16:00:00Z' },
    { id: 'future', dateTime: '2026-08-01T16:00:00Z' },
  ];
  const prior = selectPriorMeetings(meetings, 'now', '2026-07-20T16:00:00Z', 3);
  assert.deepEqual(
    prior.map((m) => m.id),
    ['a', 'b', 'c'],
  );
});

test('prior-meeting selection: none on file → empty', () => {
  const prior = selectPriorMeetings([{ id: 'now', dateTime: '2026-07-20T16:00:00Z' }], 'now', '2026-07-20T16:00:00Z');
  assert.deepEqual(prior, []);
});
