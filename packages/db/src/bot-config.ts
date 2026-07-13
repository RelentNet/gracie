/**
 * Meeting-bot configuration (Recall) — Settings → Meeting Bot (P4.2 follow-up).
 *
 * Stored in `settings` as DATA (no migration): a `bot_config` jsonb object plus a
 * separate `bot_avatar_jpeg_b64` row (kept apart so the large base64 image isn't
 * carried around when only the scalar config is needed). Read at DISPATCH time by
 * BOTH callers — the worker auto-dispatch cron and the web on-demand join — so a
 * change in Settings applies to the NEXT bot with no redeploy ("on the fly").
 *
 * Defaults live here (not a seed): with zero rows the bot is named "Gracie" with
 * no avatar and Recall's own auto-leave defaults, and the first Settings save
 * creates the rows. Server-only (service-role client).
 */
import { getServerClient } from './client.js';
import type { Json } from './database.types.js';

const CONFIG_KEY = 'bot_config';
const AVATAR_KEY = 'bot_avatar_jpeg_b64';

/** Default display name when unset (matches the Recall dispatch fallback). */
export const DEFAULT_BOT_NAME = 'Gracie';

/**
 * Transcription provider (Settings → Meeting Bot). Structurally identical to
 * `@gracie/shared`'s `RecallTranscriptProvider` so a resolved config passes
 * straight through at dispatch (db must not depend on shared):
 *   - `meeting_captions` — the platform's own captions; no extra ASR cost, but
 *     Teams Business only + depends on captions being enabled (not 100% reliable).
 *   - `recallai` — Recall's own streaming ASR; reliable regardless of caption
 *     settings, billed per hour.
 */
export type BotTranscriptProvider = 'meeting_captions' | 'recallai';

/**
 * Default transcription provider when unset. `recallai` (paid ASR) — chosen over
 * `meeting_captions` for reliability, since GA runs on Microsoft Teams where
 * caption availability depends on tenant/meeting settings. Kept in sync with
 * `@gracie/shared`'s `DEFAULT_TRANSCRIPT_PROVIDER`.
 */
export const DEFAULT_TRANSCRIPT_PROVIDER: BotTranscriptProvider = 'recallai';

const TRANSCRIPT_PROVIDERS: readonly BotTranscriptProvider[] = ['meeting_captions', 'recallai'];

/**
 * Auto-leave timeouts in SECONDS. `null` = leave the field unset so Recall applies
 * its own default (docs: automatic-leaving-behavior). Maps to Recall's flat
 * integer `automatic_leave` fields at dispatch.
 */
export interface BotAutoLeave {
  /** Leave after everyone else has left the call (`everyone_left_timeout`). */
  readonly everyoneLeftSec: number | null;
  /** Give up waiting to be admitted from the waiting room (`waiting_room_timeout`). */
  readonly waitingRoomSec: number | null;
  /** Leave if the bot never starts recording (`in_call_not_recording_timeout`). */
  readonly noRecordingSec: number | null;
  /** Leave if no one ever joins the call (`noone_joined_timeout`). */
  readonly nooneJoinedSec: number | null;
}

/** Resolved meeting-bot configuration. */
export interface BotConfig {
  readonly name: string;
  readonly avatarEnabled: boolean;
  /** Base64 JPEG (no data: prefix), or null when none stored. */
  readonly avatarJpegB64: string | null;
  readonly autoLeave: BotAutoLeave;
  /** Transcription provider sent to Recall at dispatch. */
  readonly transcriptProvider: BotTranscriptProvider;
}

/** Coerce an unknown to a non-negative integer number of seconds, or null. */
function toSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** Coerce an unknown to a known provider, falling back to the default. */
function toTranscriptProvider(value: unknown): BotTranscriptProvider {
  return TRANSCRIPT_PROVIDERS.includes(value as BotTranscriptProvider)
    ? (value as BotTranscriptProvider)
    : DEFAULT_TRANSCRIPT_PROVIDER;
}

/** Parse a stored `bot_config` jsonb blob into a typed config (defensive). */
function parseConfig(raw: Json | undefined): Omit<BotConfig, 'avatarJpegB64'> {
  const obj: Record<string, Json | undefined> =
    raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim() : DEFAULT_BOT_NAME;
  const avatarEnabled = obj.avatarEnabled === true;
  const al = obj.autoLeave !== null && typeof obj.autoLeave === 'object' && !Array.isArray(obj.autoLeave)
    ? (obj.autoLeave as Record<string, unknown>)
    : {};
  return {
    name,
    avatarEnabled,
    transcriptProvider: toTranscriptProvider(obj.transcriptProvider),
    autoLeave: {
      everyoneLeftSec: toSeconds(al.everyoneLeftSec),
      waitingRoomSec: toSeconds(al.waitingRoomSec),
      noRecordingSec: toSeconds(al.noRecordingSec),
      nooneJoinedSec: toSeconds(al.nooneJoinedSec),
    },
  };
}

/** Read the meeting-bot config, falling back to code defaults for missing rows. */
export async function getBotConfig(): Promise<BotConfig> {
  const db = getServerClient();
  const { data, error } = await db.from('settings').select('key, value').in('key', [CONFIG_KEY, AVATAR_KEY]);
  if (error !== null) throw new Error(`getBotConfig: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const base = parseConfig(byKey.get(CONFIG_KEY));
  const avatarRaw = byKey.get(AVATAR_KEY);
  const avatarJpegB64 = typeof avatarRaw === 'string' && avatarRaw !== '' ? avatarRaw : null;
  return { ...base, avatarJpegB64 };
}

/** Patch for the scalar bot config (name / avatarEnabled / transcriptProvider / autoLeave). */
export interface BotConfigPatch {
  readonly name?: string;
  readonly avatarEnabled?: boolean;
  readonly transcriptProvider?: BotTranscriptProvider;
  readonly autoLeave?: Partial<BotAutoLeave>;
}

/**
 * Merge-update the scalar bot config and return the full resolved config. Only
 * provided fields change; `autoLeave` is shallow-merged so one timeout can be set
 * without clearing the others. Admin-gated at the API layer.
 */
export async function setBotConfig(patch: BotConfigPatch): Promise<BotConfig> {
  const db = getServerClient();
  const current = await getBotConfig();

  const next = {
    name: patch.name !== undefined && patch.name.trim() !== '' ? patch.name.trim() : current.name,
    avatarEnabled: patch.avatarEnabled ?? current.avatarEnabled,
    transcriptProvider:
      patch.transcriptProvider !== undefined
        ? toTranscriptProvider(patch.transcriptProvider)
        : current.transcriptProvider,
    autoLeave: {
      everyoneLeftSec:
        patch.autoLeave?.everyoneLeftSec !== undefined
          ? toSeconds(patch.autoLeave.everyoneLeftSec)
          : current.autoLeave.everyoneLeftSec,
      waitingRoomSec:
        patch.autoLeave?.waitingRoomSec !== undefined
          ? toSeconds(patch.autoLeave.waitingRoomSec)
          : current.autoLeave.waitingRoomSec,
      noRecordingSec:
        patch.autoLeave?.noRecordingSec !== undefined
          ? toSeconds(patch.autoLeave.noRecordingSec)
          : current.autoLeave.noRecordingSec,
      nooneJoinedSec:
        patch.autoLeave?.nooneJoinedSec !== undefined
          ? toSeconds(patch.autoLeave.nooneJoinedSec)
          : current.autoLeave.nooneJoinedSec,
    },
  };

  const { error } = await db
    .from('settings')
    .upsert({ key: CONFIG_KEY, value: next as unknown as Json }, { onConflict: 'key' });
  if (error !== null) throw new Error(`setBotConfig: ${error.message}`);
  return { ...next, avatarJpegB64: current.avatarJpegB64 };
}

/** Store or clear the bot avatar JPEG (base64, no data: prefix). `null` clears it. */
export async function setBotAvatar(jpegB64: string | null): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('settings')
    .upsert({ key: AVATAR_KEY, value: (jpegB64 ?? '') as unknown as Json }, { onConflict: 'key' });
  if (error !== null) throw new Error(`setBotAvatar: ${error.message}`);
}
