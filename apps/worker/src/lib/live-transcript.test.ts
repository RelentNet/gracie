/**
 * Live-transcript pure-logic tests (meeting page Phase D). Pins the bits both ends
 * of the worker↔browser relay depend on, none of which need Redis or a live call:
 *   - `buildRecordingConfig` emits the right Recall wire shape for record-only,
 *     meeting_captions, and the two realtime combos (streaming vs captions);
 *   - `parseRealtimeTranscript` shapes a `transcript.data` event and drops noise;
 *   - the Redis channel/buffer keys + the SSE frame are stable + agree end-to-end;
 *   - `buildRealtimeTranscriptUrl` tags the ingest URL with the meeting id.
 *
 * Pure/no I/O. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRealtimeTranscriptUrl,
  formatSseData,
  liveTranscriptBufferKey,
  liveTranscriptChannel,
} from '@gracie/shared';
import { buildRecordingConfig, parseRealtimeTranscript } from '@gracie/shared/recall';

test('buildRecordingConfig: record-only default (recallai, no realtime) omits recording_config', () => {
  assert.equal(buildRecordingConfig('recallai'), null);
  assert.equal(buildRecordingConfig('recallai', null), null);
  assert.equal(buildRecordingConfig('recallai', ''), null);
});

test('buildRecordingConfig: meeting_captions (no realtime) sends the captions provider', () => {
  assert.deepEqual(buildRecordingConfig('meeting_captions'), {
    transcript: { provider: { meeting_captions: {} } },
  });
});

test('buildRecordingConfig: realtime on recallai uses recallai_streaming + the webhook endpoint', () => {
  const url = 'https://app.example.com/api/webhooks/recall/transcript?meetingId=m1';
  assert.deepEqual(buildRecordingConfig('recallai', url), {
    transcript: { provider: { recallai_streaming: {} } },
    realtime_endpoints: [{ type: 'webhook', url, events: ['transcript.data'] }],
  });
});

test('buildRecordingConfig: realtime on meeting_captions streams captions (no extra ASR)', () => {
  const url = 'https://app.example.com/api/webhooks/recall/transcript?meetingId=m1';
  assert.deepEqual(buildRecordingConfig('meeting_captions', url), {
    transcript: { provider: { meeting_captions: {} } },
    realtime_endpoints: [{ type: 'webhook', url, events: ['transcript.data'] }],
  });
});

test('parseRealtimeTranscript: shapes a transcript.data utterance into a segment', () => {
  const event = {
    event: 'transcript.data',
    data: {
      data: {
        participant: { id: 7, name: 'Ada Lovelace' },
        words: [
          { text: 'hello', start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 1.9 } },
          { text: 'there', start_timestamp: { relative: 2.0 }, end_timestamp: { relative: 2.4 } },
        ],
      },
    },
  };
  assert.deepEqual(parseRealtimeTranscript(event), {
    start: 1.5,
    end: 2.4,
    speaker: 'Ada Lovelace',
    text: 'hello there',
  });
});

test('parseRealtimeTranscript: null for empty-speech, missing nesting, or non-object', () => {
  assert.equal(parseRealtimeTranscript({ data: { data: { participant: { id: 1 }, words: [] } } }), null);
  assert.equal(parseRealtimeTranscript({ data: {} }), null);
  assert.equal(parseRealtimeTranscript({}), null);
  assert.equal(parseRealtimeTranscript(null), null);
  assert.equal(parseRealtimeTranscript('nope'), null);
});

test('channel + buffer keys are meeting-scoped and distinct', () => {
  assert.equal(liveTranscriptChannel('m1'), 'live-transcript:m1');
  assert.equal(liveTranscriptBufferKey('m1'), 'live-transcript:buf:m1');
  assert.notEqual(liveTranscriptChannel('m1'), liveTranscriptChannel('m2'));
});

test('formatSseData wraps a JSON payload as a single SSE data frame', () => {
  const json = JSON.stringify({ speaker: 'A', text: 'hi' });
  assert.equal(formatSseData(json), `data: ${json}\n\n`);
});

test('round trip: Recall event → parse → publish JSON → SSE frame → browser segment', () => {
  // The Redis hop moves the published JSON string verbatim, so this ties the whole
  // relay data contract together minus the transport: what the ingest webhook parses
  // is exactly what the browser's EventSource re-parses.
  const recallEvent = {
    event: 'transcript.data',
    data: {
      data: {
        participant: { id: 3, name: 'Grace Hopper' },
        words: [
          { text: 'ship', start_timestamp: { relative: 10 }, end_timestamp: { relative: 10.3 } },
          { text: 'it', start_timestamp: { relative: 10.4 }, end_timestamp: { relative: 10.6 } },
        ],
      },
    },
  };
  const utterance = parseRealtimeTranscript(recallEvent);
  assert.notEqual(utterance, null);

  // publishLiveUtterance serializes with JSON.stringify; the SSE route re-frames
  // that exact string with formatSseData.
  const published = JSON.stringify(utterance);
  const frame = formatSseData(published);

  // What the browser does: strip the `data: ` prefix + trailing blank line, JSON.parse.
  assert.ok(frame.startsWith('data: '));
  assert.ok(frame.endsWith('\n\n'));
  const received = JSON.parse(frame.slice('data: '.length).trimEnd());
  assert.deepEqual(received, { start: 10, end: 10.6, speaker: 'Grace Hopper', text: 'ship it' });
});

test('buildRealtimeTranscriptUrl tags the ingest URL with an encoded meeting id', () => {
  assert.equal(
    buildRealtimeTranscriptUrl('https://app.example.com', 'abc-123'),
    'https://app.example.com/api/webhooks/recall/transcript?meetingId=abc-123',
  );
  // Tolerates a trailing slash on the base URL (no double slash).
  assert.equal(
    buildRealtimeTranscriptUrl('https://app.example.com/', 'm1'),
    'https://app.example.com/api/webhooks/recall/transcript?meetingId=m1',
  );
});
