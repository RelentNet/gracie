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

import { createHash } from 'node:crypto';

import { getBotConfig, getCredential, getServerClient } from '@gracie/db';
import {
  leaveRecallBot,
  parseRealtimeParticipant,
  parseVoiceCommand,
  pauseRecallBot,
  sendRecallChatMessage,
  type VoiceCommand,
} from '@gracie/shared/recall';

import { createVoiceActionItem, type VoiceActionItemOutcome } from '@/lib/data/tasks';
import { claimOnce } from '@/lib/live-transcript';
import { enqueueResumeRecording } from '@/lib/queue';

type Db = ReturnType<typeof getServerClient>;
type Recall = { apiKey: string; region: string | undefined };

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
      .select('bot_job_id, client_id, is_internal')
      .eq('id', meetingId)
      .maybeSingle();
    if (error !== null) {
      console.error('[voice-command] meeting lookup failed', error);
      return;
    }
    if (meeting === null) return;
    const botJobId = meeting.bot_job_id;
    if (typeof botJobId !== 'string' || botJobId === '') return;

    const apiKey = await getCredential('recall');
    if (apiKey === null || apiKey === '') {
      console.error('[voice-command] no Recall API key configured — cannot act');
      return;
    }
    const recall: Recall = { apiKey, region: process.env.RECALL_REGION };

    // 5. Debounce: first caller per meeting+command within the window wins. Action items
    // key on their text too, so two DIFFERENT items aren't collapsed — only STT repeats
    // of the SAME one.
    const claimKey =
      command.kind === 'action_item'
        ? `voice-cmd:${meetingId}:action_item:${itemHash(command.text)}`
        : `voice-cmd:${meetingId}:${command.kind}`;
    if (!(await claimOnce(claimKey, DEBOUNCE_SECONDS))) return;

    // 6. Act. Action items create a task then confirm (so we never claim success falsely);
    // the controls confirm in chat BEFORE acting (best-effort — a chat blip can't block them).
    if (command.kind === 'action_item') {
      await captureActionItem(db, botJobId, meetingId, meeting, command.text, recall);
      return;
    }
    await announceAndAct(botJobId, meetingId, command, recall);
  } catch (err) {
    console.error('[voice-command] handler error', err);
  }
}

/** Stable short key for the debounce so an STT-repeated item collapses to one action. */
function itemHash(text: string): string {
  return createHash('sha1').update(text.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/** Post a chat message, swallowing failures (the in-meeting chat is best-effort). */
async function safeChat(botJobId: string, message: string, recall: Recall): Promise<void> {
  try {
    await sendRecallChatMessage(botJobId, message, recall);
  } catch (err) {
    console.error('[voice-command] chat message failed', err);
  }
}

/**
 * Resolve the client this meeting's tasks belong to: the meeting's primary org, or the
 * internal GA org for an internal meeting, else null (an unassigned external meeting has
 * no client to scope a task under yet).
 */
async function resolveMeetingClientId(
  db: Db,
  meeting: { client_id: string | null; is_internal: boolean },
): Promise<string | null> {
  if (meeting.client_id !== null && meeting.client_id !== '') return meeting.client_id;
  if (!meeting.is_internal) return null;
  const { data, error } = await db
    .from('clients')
    .select('id')
    .eq('type', 'internal')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    console.error('[voice-command] internal org lookup failed', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Create a task from a dictated action item and confirm it in the meeting chat. Creates
 * FIRST, then confirms — so Gracie never says "added" for something that didn't save.
 * When the meeting has no client yet, we can't scope a task, so we say so plainly.
 */
async function captureActionItem(
  db: Db,
  botJobId: string,
  meetingId: string,
  meeting: { client_id: string | null; is_internal: boolean },
  text: string,
  recall: Recall,
): Promise<void> {
  const clientId = await resolveMeetingClientId(db, meeting);
  if (clientId === null) {
    console.warn(`[voice-command] action item skipped — meeting ${meetingId} has no client`);
    await safeChat(botJobId, 'I couldn’t add that action item — this meeting isn’t linked to a client yet.', recall);
    return;
  }

  let outcome: VoiceActionItemOutcome;
  try {
    outcome = await createVoiceActionItem(clientId, meetingId, text);
  } catch (err) {
    console.error('[voice-command] action item create failed', err);
    await safeChat(botJobId, 'Sorry — I hit an error saving that action item.', recall);
    return;
  }

  const short = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  const message =
    outcome === 'insert'
      ? `Noted — added: “${short}”`
      : outcome === 'escalate'
        ? 'Noted — that’s already on the list; I bumped it to high priority.'
        : 'Noted — I reopened that one and set it to high priority.';
  await safeChat(botJobId, message, recall);
  console.info(`[voice-command] action item (${outcome}) on meeting ${meetingId}`);
}

async function announceAndAct(
  botJobId: string,
  meetingId: string,
  command: Extract<VoiceCommand, { kind: 'leave' | 'pause' }>,
  recall: Recall,
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
