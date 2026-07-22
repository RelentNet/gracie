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

import {
  DEFAULT_TRANSCRIPT_PROVIDER,
  buildTranscriptProviderConfig,
  dispatchRecallBot,
  ensureAsyncTranscript,
  fetchRecallTranscript,
  flattenRecallTranscript,
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
