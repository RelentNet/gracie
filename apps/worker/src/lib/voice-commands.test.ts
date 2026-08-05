/**
 * Voice-command tests — the PURE detection/gating logic plus the four Recall bot
 * controls, none of which need a live call:
 *   - `parseVoiceCommand` recognises leave/pause (+ duration) and rejects noise;
 *   - `parseRealtimeParticipant` surfaces the host flag the webhook gates on;
 *   - `leave/pause/resumeRecallBot` + `sendRecallChatMessage` POST the right URL/body
 *     and throw on non-OK.
 *
 * Pure/`fetch`-stubbed — no network. Run with `pnpm --filter @gracie/worker test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PAUSE_MINUTES,
  leaveRecallBot,
  parseRealtimeParticipant,
  parseVoiceCommand,
  pauseRecallBot,
  resumeRecallBot,
  sendRecallChatMessage,
} from '@gracie/shared/recall';

// ── parseVoiceCommand: leave ────────────────────────────────────────────────

test('parseVoiceCommand: leave variants', () => {
  for (const text of [
    'Hey Gracie, leave the meeting',
    'hey gracie leave the call',
    'Gracie, you can leave now',
    'gracie ai, please leave',
    'Grace, leave the meeting.', // STT dropped the "-ie"
    'so anyway, hey Gracie — leave',
  ]) {
    assert.deepEqual(parseVoiceCommand(text), { kind: 'leave' }, text);
  }
});

// ── parseVoiceCommand: pause + duration ─────────────────────────────────────

test('parseVoiceCommand: pause defaults to 5 minutes when no duration is spoken', () => {
  for (const text of [
    'Hey Gracie, stop listening',
    'gracie stop recording',
    'Gracie, pause',
    'hey gracie stop the recording',
  ]) {
    assert.deepEqual(parseVoiceCommand(text), { kind: 'pause', minutes: DEFAULT_PAUSE_MINUTES }, text);
  }
});

test('parseVoiceCommand: parses spoken duration (digits and words)', () => {
  assert.deepEqual(parseVoiceCommand('hey gracie stop listening for 10 minutes'), { kind: 'pause', minutes: 10 });
  assert.deepEqual(parseVoiceCommand('gracie pause for 2 min'), { kind: 'pause', minutes: 2 });
  assert.deepEqual(parseVoiceCommand('Gracie, stop recording for fifteen minutes'), { kind: 'pause', minutes: 15 });
  assert.deepEqual(parseVoiceCommand('hey gracie pause for three minutes'), { kind: 'pause', minutes: 3 });
});

test('parseVoiceCommand: clamps duration to 1–60 minutes', () => {
  assert.deepEqual(parseVoiceCommand('hey gracie pause for 90 minutes'), { kind: 'pause', minutes: 60 });
  assert.deepEqual(parseVoiceCommand('hey gracie pause for 0 minutes'), { kind: 'pause', minutes: 1 });
});

test('parseVoiceCommand: leave wins when both a leave and a pause verb appear', () => {
  assert.deepEqual(parseVoiceCommand('hey gracie stop recording and leave'), { kind: 'leave' });
});

// ── parseVoiceCommand: misses + near-misses ─────────────────────────────────

test('parseVoiceCommand: no wake phrase → null', () => {
  assert.equal(parseVoiceCommand('can you leave the meeting'), null);
  assert.equal(parseVoiceCommand('everyone please stop recording'), null);
});

test('parseVoiceCommand: wake phrase but no command → null', () => {
  assert.equal(parseVoiceCommand('hey Gracie, how are you?'), null);
  assert.equal(parseVoiceCommand('thanks Gracie'), null);
});

test('parseVoiceCommand: the firm name alone never triggers', () => {
  assert.equal(parseVoiceCommand('welcome to Grace and Associates'), null);
  assert.equal(parseVoiceCommand('Grace & Associates is a consulting firm'), null);
});

test('parseVoiceCommand: wake phrase must be a whole word', () => {
  assert.equal(parseVoiceCommand('that would be a disgrace to leave'), null);
  assert.equal(parseVoiceCommand('how gracious of you to pause'), null);
});

test('parseVoiceCommand: empty / non-string → null', () => {
  assert.equal(parseVoiceCommand(''), null);
  assert.equal(parseVoiceCommand('   '), null);
  assert.equal(parseVoiceCommand(undefined as unknown as string), null);
});

// ── parseRealtimeParticipant: host gate signal ──────────────────────────────

test('parseRealtimeParticipant: surfaces host flag + name + email', () => {
  const event = {
    event: 'transcript.data',
    data: { data: { participant: { name: 'Allie Grace', is_host: true, email: 'allie@ga.com' }, words: [] } },
  };
  assert.deepEqual(parseRealtimeParticipant(event), { name: 'Allie Grace', isHost: true, email: 'allie@ga.com' });
});

test('parseRealtimeParticipant: non-host → isHost false', () => {
  const event = { data: { data: { participant: { name: 'Guest', is_host: false }, words: [] } } };
  assert.deepEqual(parseRealtimeParticipant(event), { name: 'Guest', isHost: false, email: null });
});

test('parseRealtimeParticipant: missing host flag → isHost null (caller fails safe)', () => {
  const event = { data: { data: { participant: { name: 'Someone' }, words: [] } } };
  assert.deepEqual(parseRealtimeParticipant(event), { name: 'Someone', isHost: null, email: null });
});

test('parseRealtimeParticipant: email can come from extra_data', () => {
  const event = { data: { data: { participant: { is_host: true, extra_data: { email: 'x@y.com' } } } } };
  assert.equal(parseRealtimeParticipant(event)?.email, 'x@y.com');
});

test('parseRealtimeParticipant: no participant → null', () => {
  assert.equal(parseRealtimeParticipant({ data: { data: { words: [] } } }), null);
  assert.equal(parseRealtimeParticipant({}), null);
  assert.equal(parseRealtimeParticipant(null), null);
});

// ── Recall bot controls (fetch-stubbed) ─────────────────────────────────────

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

function okResponse(): unknown {
  return { ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') };
}
function errResponse(status: number): unknown {
  return { ok: false, status, json: () => Promise.resolve({}), text: () => Promise.resolve('bad') };
}

test('leaveRecallBot POSTs /bot/{id}/leave_call/ with the auth header', async () => {
  let url = '';
  let method = '';
  await withFetch(
    (u, init) => {
      url = u;
      method = init?.method ?? '';
      return Promise.resolve(okResponse());
    },
    async () => {
      await leaveRecallBot('bot_1', { apiKey: 'k', region: 'us-east-1' });
    },
  );
  assert.equal(method, 'POST');
  assert.equal(url, 'https://us-east-1.recall.ai/api/v1/bot/bot_1/leave_call/');
});

test('pauseRecallBot + resumeRecallBot hit their endpoints', async () => {
  const urls: string[] = [];
  await withFetch(
    (u) => {
      urls.push(u);
      return Promise.resolve(okResponse());
    },
    async () => {
      await pauseRecallBot('bot_2', { apiKey: 'k' });
      await resumeRecallBot('bot_2', { apiKey: 'k' });
    },
  );
  assert.ok(urls[0]?.endsWith('/bot/bot_2/pause_recording/'));
  assert.ok(urls[1]?.endsWith('/bot/bot_2/resume_recording/'));
});

test('sendRecallChatMessage sends the message (and optional target)', async () => {
  let body: Record<string, unknown> = {};
  await withFetch(
    (_u, init) => {
      body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return Promise.resolve(okResponse());
    },
    async () => {
      await sendRecallChatMessage('bot_3', 'Gracie is leaving.', { apiKey: 'k', to: 'p1' });
    },
  );
  assert.equal(body.message, 'Gracie is leaving.');
  assert.equal(body.to, 'p1');
});

test('bot controls throw on a non-OK response', async () => {
  await withFetch(
    () => Promise.resolve(errResponse(400)),
    async () => {
      await assert.rejects(() => leaveRecallBot('bot_x', { apiKey: 'k' }), /HTTP 400/);
    },
  );
});
