/**
 * Recall dispatch/fetch shape tests (go-live transcription fix). Proves:
 *   - `buildTranscriptProviderConfig` emits the exact Recall wire shapes.
 *   - `dispatchRecallBot` ALWAYS sends `recording_config.transcript.provider`
 *     (the missing piece that left real bots un-transcribed), defaulting to
 *     `recallai` and honoring an explicit provider.
 *   - `flattenRecallTranscript` flattens the current download shape
 *     (`[{ participant, words }]`) and treats empty/no-speech as "".
 *   - `fetchRecallTranscript` walks bot → media_shortcuts.transcript.download_url
 *     → parsed transcript, and throws when the transcript is not ready.
 *
 * Pure/dependency-injected: `fetch` is stubbed so no network is touched. Run with
 * `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeSegmentIndex, formatClock } from '@gracie/shared';
import {
  DEFAULT_TRANSCRIPT_PROVIDER,
  buildTranscriptProviderConfig,
  classifyRecordings,
  dispatchRecallBot,
  ensureAsyncTranscript,
  fetchRecallMedia,
  fetchRecallTranscript,
  findVideoMixedUrl,
  flattenRecallTranscript,
  shapeTranscriptSegments,
} from '@gracie/shared/recall';

/** Install a fetch stub for the duration of `fn`, restoring the real fetch after. */
async function withFetch(
  impl: (url: string, init?: { method?: string; headers?: unknown; body?: string }) => Promise<unknown>,
  fn: () => Promise<void>,
): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** A minimal ok/json Response-like. */
function jsonResponse(body: unknown, ok = true, status = 200): unknown {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

test('buildTranscriptProviderConfig emits the exact Recall wire shapes', () => {
  assert.deepEqual(buildTranscriptProviderConfig('meeting_captions'), { meeting_captions: {} });
  // recallai = record-only at create: our account's create-bot rejects
  // recallai_async (verified 2026-07-22, HTTP 400), and streaming's live
  // connection failure mode cost a client meeting its documents. The async
  // transcript is requested post-recording (ensureAsyncTranscript). No
  // `recallai` value may ever map to recallai_streaming.
  assert.equal(buildTranscriptProviderConfig('recallai'), null);
});

test('dispatchRecallBot sends NO transcript config for the default (recallai) provider', async () => {
  assert.equal(DEFAULT_TRANSCRIPT_PROVIDER, 'recallai');
  let sent: Record<string, unknown> | undefined;
  await withFetch(
    (_url, init) => {
      sent = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return Promise.resolve(jsonResponse({ id: 'bot_123' }));
    },
    async () => {
      const id = await dispatchRecallBot({ meetingUrl: 'https://x', apiKey: 'k' });
      assert.equal(id, 'bot_123');
    },
  );
  // Record-only: recording_config must be absent entirely — an empty transcript
  // block or a null provider would 400 at Recall.
  assert.equal(sent?.recording_config, undefined);
});

test('dispatchRecallBot honors an explicit provider', async () => {
  let sent: Record<string, unknown> | undefined;
  await withFetch(
    (_url, init) => {
      sent = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return Promise.resolve(jsonResponse({ id: 'bot_9' }));
    },
    async () => {
      await dispatchRecallBot({ meetingUrl: 'https://x', apiKey: 'k', transcriptProvider: 'meeting_captions' });
    },
  );
  const recordingConfig = sent?.recording_config as { transcript?: { provider?: unknown } } | undefined;
  assert.deepEqual(recordingConfig?.transcript?.provider, { meeting_captions: {} });
});

test('flattenRecallTranscript flattens the current download shape', () => {
  const segments = [
    { participant: { id: 1, name: 'Daniel Velez' }, words: [{ text: 'Hello' }, { text: 'there' }] },
    { participant: { id: 2, name: 'Allie Grace' }, words: [{ text: 'Hi' }] },
    { participant: { id: 3, name: null }, words: [{ text: 'anon' }] },
  ];
  assert.equal(
    flattenRecallTranscript(segments),
    'Daniel Velez: Hello there\nAllie Grace: Hi\nSpeaker 3: anon',
  );
});

test('flattenRecallTranscript returns "" for empty / no-speech transcripts', () => {
  assert.equal(flattenRecallTranscript([]), '');
  assert.equal(flattenRecallTranscript(null), '');
  assert.equal(flattenRecallTranscript([{ participant: { id: 1, name: 'X' }, words: [] }]), '');
});

test('fetchRecallTranscript walks bot → media_shortcuts.transcript → download', async () => {
  const botPayload = {
    recordings: [
      {
        media_shortcuts: {
          transcript: {
            status: { code: 'done' },
            data: { download_url: 'https://dl/transcript?token=abc' },
          },
        },
      },
    ],
  };
  const transcriptPayload = [
    { participant: { id: 1, name: 'Daniel Velez' }, words: [{ text: 'Recovered' }] },
  ];
  const seen: string[] = [];
  await withFetch(
    (url, init) => {
      seen.push(url);
      // The download URL must be fetched WITHOUT the Recall auth header.
      if (url.includes('/bot/')) {
        assert.ok((init?.headers as Record<string, string>).Authorization?.startsWith('Token '));
        return Promise.resolve(jsonResponse(botPayload));
      }
      assert.equal((init?.headers as Record<string, string>)?.Authorization, undefined);
      return Promise.resolve(jsonResponse(transcriptPayload));
    },
    async () => {
      const out = await fetchRecallTranscript('bot_abc', { apiKey: 'k', region: 'us-west-2' });
      assert.equal(out, 'Daniel Velez: Recovered');
    },
  );
  assert.equal(seen.length, 2);
});

test('fetchRecallTranscript throws when the transcript is not ready', async () => {
  const botPayload = { recordings: [{ media_shortcuts: { transcript: null } }] };
  await withFetch(
    () => Promise.resolve(jsonResponse(botPayload)),
    async () => {
      await assert.rejects(fetchRecallTranscript('bot_x', { apiKey: 'k' }), /not ready/);
    },
  );
});

test('ensureAsyncTranscript requests recallai_async on a bare finished recording', async () => {
  const botPayload = { recordings: [{ id: 'rec_1', media_shortcuts: {} }] };
  const calls: Array<{ url: string; body?: string }> = [];
  await withFetch(
    (url, init) => {
      calls.push({ url, body: init?.body });
      return Promise.resolve(jsonResponse(url.includes('create_transcript') ? {} : botPayload));
    },
    async () => {
      assert.equal(await ensureAsyncTranscript('bot_a', { apiKey: 'k' }), 'created');
    },
  );
  assert.equal(calls.length, 2);
  const create = calls[1];
  assert.ok(create !== undefined);
  assert.ok(create.url.endsWith('/recording/rec_1/create_transcript/'));
  const body = JSON.parse(create.body ?? '{}') as { provider?: unknown };
  assert.deepEqual(body.provider, { recallai_async: { language_code: 'auto' } });
});

test('ensureAsyncTranscript is a no-op when a transcript already exists (idempotent on Svix retries)', async () => {
  const botPayload = {
    recordings: [{ id: 'rec_1', media_shortcuts: { transcript: { status: { code: 'processing' } } } }],
  };
  let createCalled = false;
  await withFetch(
    (url) => {
      if (url.includes('create_transcript')) createCalled = true;
      return Promise.resolve(jsonResponse(botPayload));
    },
    async () => {
      assert.equal(await ensureAsyncTranscript('bot_a', { apiKey: 'k' }), 'already_requested');
    },
  );
  assert.equal(createCalled, false);
});

test('ensureAsyncTranscript reports no_recording when the bot never recorded', async () => {
  await withFetch(
    () => Promise.resolve(jsonResponse({ recordings: [] })),
    async () => {
      assert.equal(await ensureAsyncTranscript('bot_a', { apiKey: 'k' }), 'no_recording');
    },
  );
});

// --- classifyRecordings: the 3-way recoverability pre-flight (brief §3.2) ----------

test('classifyRecordings: a completed downloadable transcript → regenerate', () => {
  const rec = classifyRecordings({
    recordings: [
      { id: 'rec_1', media_shortcuts: { transcript: { status: { code: 'done' }, data: { download_url: 'https://dl/t' } } } },
    ],
  });
  assert.equal(rec.state, 'regenerate');
});

test('classifyRecordings: recording present but transcript FAILED → retranscribe (the Leap Metrics case)', () => {
  const rec = classifyRecordings({
    recordings: [
      {
        id: 'rec_9',
        media_shortcuts: { transcript: { status: { code: 'failed', sub_code: 'provider_connection_failed' } } },
      },
    ],
  });
  assert.equal(rec.state, 'retranscribe');
  assert.equal(rec.recordingId, 'rec_9');
  assert.equal(rec.transcriptPending, false);
  // The raw provider code is available for support, never as a headline.
  assert.equal(rec.detail, 'provider_connection_failed');
});

test('classifyRecordings: recording present, NO transcript object yet → retranscribe', () => {
  const rec = classifyRecordings({ recordings: [{ id: 'rec_2', media_shortcuts: {} }] });
  assert.equal(rec.state, 'retranscribe');
  assert.equal(rec.recordingId, 'rec_2');
});

test('classifyRecordings: an in-flight transcript flags transcriptPending (caller waits)', () => {
  const rec = classifyRecordings({
    recordings: [{ id: 'rec_3', media_shortcuts: { transcript: { status: { code: 'processing' } } } }],
  });
  assert.equal(rec.state, 'retranscribe');
  assert.equal(rec.transcriptPending, true);
});

test('classifyRecordings: no recording at all → unrecoverable', () => {
  assert.equal(classifyRecordings({ recordings: [] }).state, 'unrecoverable');
  assert.equal(classifyRecordings({}).state, 'unrecoverable');
});

test('classifyRecordings: a done transcript on ANY recording wins over an earlier failed one', () => {
  const rec = classifyRecordings({
    recordings: [
      { id: 'rec_a', media_shortcuts: { transcript: { status: { code: 'failed' } } } },
      { id: 'rec_b', media_shortcuts: { transcript: { status: { code: 'done' }, data: { download_url: 'https://dl/t' } } } },
    ],
  });
  assert.equal(rec.state, 'regenerate');
});

// --- Phase C recorded-media helpers -----------------------------------------------

test('shapeTranscriptSegments: start = first word, end = last word (seconds), with speaker + text', () => {
  const raw = [
    {
      participant: { id: 1, name: 'Daniel Velez' },
      words: [
        { text: 'Hello', start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 2.0 } },
        { text: 'there', start_timestamp: { relative: 2.0 }, end_timestamp: { relative: 2.6 } },
      ],
    },
    {
      participant: { id: 2, name: null },
      words: [{ text: 'Hi', start_timestamp: { relative: 3.0 }, end_timestamp: { relative: 3.4 } }],
    },
  ];
  assert.deepEqual(shapeTranscriptSegments(raw), [
    { start: 1.5, end: 2.6, speaker: 'Daniel Velez', text: 'Hello there' },
    { start: 3.0, end: 3.4, speaker: 'Speaker 2', text: 'Hi' },
  ]);
});

test('shapeTranscriptSegments: missing timestamps → null start/end; empty/no-speech dropped; non-array → []', () => {
  const raw = [
    { participant: { name: 'X' }, words: [{ text: 'no-times' }] },
    { participant: { name: 'Y' }, words: [] }, // no speech → dropped
  ];
  assert.deepEqual(shapeTranscriptSegments(raw), [{ start: null, end: null, speaker: 'X', text: 'no-times' }]);
  assert.deepEqual(shapeTranscriptSegments(null), []);
  assert.deepEqual(shapeTranscriptSegments('nope'), []);
});

test('findVideoMixedUrl: returns the first mixed-video download URL, else null', () => {
  assert.equal(
    findVideoMixedUrl({
      recordings: [
        { id: 'r1', media_shortcuts: {} },
        { id: 'r2', media_shortcuts: { video_mixed: { data: { download_url: 'https://dl/video.mp4' } } } },
      ],
    }),
    'https://dl/video.mp4',
  );
  assert.equal(findVideoMixedUrl({ recordings: [{ id: 'r1', media_shortcuts: {} }] }), null);
  assert.equal(findVideoMixedUrl({}), null);
});

test('fetchRecallMedia: pulls video URL + duration + shaped segments from ONE bot retrieve', async () => {
  const botPayload = {
    recordings: [
      {
        id: 'rec_1',
        started_at: '2026-08-03T15:00:00Z',
        completed_at: '2026-08-03T15:30:00Z',
        media_shortcuts: {
          video_mixed: { data: { download_url: 'https://dl/video.mp4' } },
          transcript: { status: { code: 'done' }, data: { download_url: 'https://dl/t?token=x' } },
        },
      },
    ],
  };
  const transcriptPayload = [
    { participant: { id: 1, name: 'A' }, words: [{ text: 'Hi', start_timestamp: { relative: 0 }, end_timestamp: { relative: 1 } }] },
  ];
  await withFetch(
    (url) => Promise.resolve(jsonResponse(url.includes('/bot/') ? botPayload : transcriptPayload)),
    async () => {
      const media = await fetchRecallMedia('bot_1', { apiKey: 'k' });
      assert.equal(media.videoUrl, 'https://dl/video.mp4');
      assert.equal(media.durationS, 1800); // 30 min
      assert.deepEqual(media.segments, [{ start: 0, end: 1, speaker: 'A', text: 'Hi' }]);
    },
  );
});

test('fetchRecallMedia: no video + no transcript → nulls/[] (best-effort, never throws)', async () => {
  await withFetch(
    () => Promise.resolve(jsonResponse({ recordings: [{ id: 'rec_1', media_shortcuts: {} }] })),
    async () => {
      const media = await fetchRecallMedia('bot_1', { apiKey: 'k' });
      assert.equal(media.videoUrl, null);
      assert.equal(media.durationS, null);
      assert.deepEqual(media.segments, []);
    },
  );
});

// --- Phase C player: seek/highlight sync helpers ----------------------------------

test('activeSegmentIndex: the LAST segment at/behind t is active (click-to-seek highlight)', () => {
  const segs = [
    { start: 0, end: 2, speaker: 'A', text: 'one' },
    { start: 2, end: 5, speaker: 'B', text: 'two' },
    { start: 5, end: 9, speaker: 'A', text: 'three' },
  ];
  assert.equal(activeSegmentIndex(segs, -1), -1); // before the first
  assert.equal(activeSegmentIndex(segs, 0), 0);
  assert.equal(activeSegmentIndex(segs, 4.9), 1);
  assert.equal(activeSegmentIndex(segs, 5), 2);
  assert.equal(activeSegmentIndex(segs, 100), 2); // past the end → last
});

test('activeSegmentIndex: segments without a start timestamp are skipped, never active', () => {
  const segs = [
    { start: null, end: null, speaker: 'A', text: 'untimed' },
    { start: 3, end: 4, speaker: 'B', text: 'timed' },
  ];
  assert.equal(activeSegmentIndex(segs, 0), -1);
  assert.equal(activeSegmentIndex(segs, 3), 1);
  assert.equal(activeSegmentIndex([], 5), -1);
});

test('formatClock: m:ss under an hour, h:mm:ss past it', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9), '0:09');
  assert.equal(formatClock(75), '1:15');
  assert.equal(formatClock(3661), '1:01:01');
  assert.equal(formatClock(-5), '0:00');
});
