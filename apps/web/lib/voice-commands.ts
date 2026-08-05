/**
 * In-meeting voice-command handler (server-only). The realtime transcript webhook
 * calls this FIRE-AND-FORGET on every utterance so the Recall ack still returns in
 * milliseconds; the (rare) real work only runs on a positive command match.
 *
 * Safety, in order — any failing gate returns without acting (fail safe):
 *   1. parseVoiceCommand(text) — pure; a wake phrase + a command verb, else null.
 *   2. bot config — BOTH `realtimeTranscript` AND `voiceCommands` must be on.
 *   3. HOST gate — only a participant Recall marks `is_host` is obeyed. If the
 *      platform doesn't report a host flag we do NOT act (see the limitation note).
 *   4. debounce — one action per meeting+command within a short window (STT repeats).
 *   5. visible chat confirmation BEFORE the action, so nothing happens silently.
 *
 * The utterance text is already parsed by the webhook; we re-receive the raw event
 * only to read the participant for the host gate.
 */
import 'server-only';

import { getBotConfig, getCredential, getServerClient } from '@gracie/db';
import {
  leaveRecallBot,
  parseRealtimeParticipant,
  parseVoiceCommand,
  pauseRecallBot,
  sendRecallChatMessage,
  type VoiceCommand,
} from '@gracie/shared/recall';

import { claimOnce } from '@/lib/live-transcript';
import { enqueueResumeRecording } from '@/lib/queue';

/** Debounce window (s): collapse the STT's repeated utterances into one action. */
const DEBOUNCE_SECONDS = 30;

/**
 * Detect + act on a voice command in one utterance. Never throws — the webhook
 * fire-and-forgets it, so all failures are logged here and swallowed. `rawEvent` is
 * the parsed `transcript.data` body (for the participant/host gate); `text` is the
 * utterance the webhook already extracted.
 */
export async function handleVoiceCommand(
  meetingId: string,
  rawEvent: unknown,
  text: string,
): Promise<void> {
  try {
    // 1. Pure parse — the cheap gate that keeps the hot path off the DB for normal speech.
    const command = parseVoiceCommand(text);
    if (command === null) return;

    // 2. Config: inert unless BOTH realtime transcript and voice commands are on.
    const config = await getBotConfig();
    if (!config.realtimeTranscript || !config.voiceCommands) return;

    // 3. Host gate — obey only the meeting host. `is_host` is Recall's per-platform
    // host flag; when the platform omits it (null) we fail safe and do nothing.
    const participant = parseRealtimeParticipant(rawEvent);
    if (participant?.isHost !== true) {
      console.warn(
        `[voice-command] ignoring "${command.kind}" — speaker not confirmed host (isHost=${participant?.isHost ?? 'null'})`,
      );
      return;
    }

    // 4. Resolve the bot + Recall credentials.
    const db = getServerClient();
    const { data: meeting, error } = await db
      .from('meetings')
      .select('bot_job_id')
      .eq('id', meetingId)
      .maybeSingle();
    if (error !== null) {
      console.error('[voice-command] meeting lookup failed', error);
      return;
    }
    const botJobId = meeting?.bot_job_id;
    if (typeof botJobId !== 'string' || botJobId === '') return;

    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      console.error('[voice-command] no Recall API key configured — cannot act');
      return;
    }
    const recall = { apiKey, region: process.env.RECALL_REGION };

    // 5. Debounce: first caller per meeting+command within the window wins.
    const claimed = await claimOnce(`voice-cmd:${meetingId}:${command.kind}`, DEBOUNCE_SECONDS);
    if (!claimed) return;

    // 6. Confirm in chat BEFORE acting, then act. The confirmation is best-effort —
    // a chat failure must not block the requested action.
    await announceAndAct(botJobId, meetingId, command, recall);
  } catch (err) {
    console.error('[voice-command] handler error', err);
  }
}

async function announceAndAct(
  botJobId: string,
  meetingId: string,
  command: VoiceCommand,
  recall: { apiKey: string; region: string | undefined },
): Promise<void> {
  const confirmation =
    command.kind === 'leave'
      ? 'Gracie is leaving at a participant’s request.'
      : `Gracie will stop recording for ${command.minutes} minute${command.minutes === 1 ? '' : 's'}.`;
  try {
    await sendRecallChatMessage(botJobId, confirmation, recall);
  } catch (err) {
    console.error('[voice-command] chat confirmation failed (acting anyway)', err);
  }

  if (command.kind === 'leave') {
    await leaveRecallBot(botJobId, recall);
    console.info(`[voice-command] bot left meeting ${meetingId} on host request`);
    return;
  }

  await pauseRecallBot(botJobId, recall);
  await enqueueResumeRecording(botJobId, meetingId, command.minutes);
  console.info(`[voice-command] paused meeting ${meetingId} for ${command.minutes}m on host request`);
}
