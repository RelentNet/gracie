/**
 * Admin-only meeting-bot configuration (Settings → Meeting Bot). Governs how the
 * Recall bot appears/behaves in a call — name, avatar tile, auto-leave. DB-backed
 * so changes apply to the next dispatch (auto cron OR on-demand join) with no
 * redeploy. Distinct from the bot kill-switches; this is appearance/behavior only.
 *
 *   GET   → `{ config }` (name, avatarEnabled, autoLeave, hasAvatar, avatarDataUrl)
 *   PATCH → update any of `{ name?, avatarEnabled?, autoLeave?, avatar? }`; the
 *           `avatar` field is `{ jpegB64 }` to set (validated) or `null` to clear.
 *
 * Both are Admin only (docs/02 §D14); non-admins receive a 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getBotConfig, setBotAvatar, setBotConfig } from '@gracie/db';
import type { BotConfig } from '@gracie/db';

import { getRequestUser, isAdmin } from '@/lib/api-auth';

// @gracie/db (service-role client) is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

/** Recall caps `bot_name` at 100 chars; the avatar JPEG at ~1.3 MB. */
const MAX_NAME_LEN = 100;
const MAX_AVATAR_BYTES = 1_300_000;

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

/** Client-facing view: expose the avatar as a data URL for preview, not raw b64. */
function toClient(config: BotConfig): Record<string, unknown> {
  return {
    name: config.name,
    avatarEnabled: config.avatarEnabled,
    autoLeave: config.autoLeave,
    hasAvatar: config.avatarJpegB64 !== null,
    avatarDataUrl: config.avatarJpegB64 !== null ? `data:image/jpeg;base64,${config.avatarJpegB64}` : null,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    return NextResponse.json({ config: toClient(await getBotConfig()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'bot_settings_read_failed', message } }, { status: 500 });
  }
}

interface BotPatchBody {
  readonly name?: unknown;
  readonly avatarEnabled?: unknown;
  readonly autoLeave?: unknown;
  readonly avatar?: unknown;
}

/** Coerce one auto-leave field: a non-negative number, or null (any other value). */
function optionalSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Validate + normalize an incoming avatar JPEG. Accepts a bare base64 string or a
 * `data:image/jpeg;base64,…` URL. Returns the clean base64, or an error message.
 */
function normalizeAvatar(jpegB64: string): { b64: string } | { error: string } {
  const b64 = jpegB64.includes(',') ? jpegB64.slice(jpegB64.indexOf(',') + 1) : jpegB64;
  // Guard before decoding: base64 is ~4/3 the byte size; cap the string length.
  if (b64.length > MAX_AVATAR_BYTES * 1.4) return { error: 'Image is too large (max 1.3 MB).' };
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return { error: 'Image could not be decoded.' };
  }
  if (buf.length === 0) return { error: 'Image is empty.' };
  if (buf.length > MAX_AVATAR_BYTES) return { error: 'Image is too large (max 1.3 MB).' };
  // JPEG magic bytes (Recall accepts JPEG only).
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return { error: 'Image must be a JPEG.' };
  }
  return { b64 };
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const body = (await request.json().catch(() => ({}))) as BotPatchBody;

    const patch: {
      name?: string;
      avatarEnabled?: boolean;
      autoLeave?: {
        everyoneLeftSec: number | null;
        waitingRoomSec: number | null;
        noRecordingSec: number | null;
        nooneJoinedSec: number | null;
      };
    } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return badRequest('name must be a non-empty string.');
      }
      if (body.name.trim().length > MAX_NAME_LEN) {
        return badRequest(`name must be ${MAX_NAME_LEN} characters or fewer.`);
      }
      patch.name = body.name.trim();
    }
    if (body.avatarEnabled !== undefined) {
      if (typeof body.avatarEnabled !== 'boolean') return badRequest('avatarEnabled must be a boolean.');
      patch.avatarEnabled = body.avatarEnabled;
    }
    if (body.autoLeave !== undefined) {
      if (body.autoLeave === null || typeof body.autoLeave !== 'object' || Array.isArray(body.autoLeave)) {
        return badRequest('autoLeave must be an object.');
      }
      const al = body.autoLeave as Record<string, unknown>;
      patch.autoLeave = {
        everyoneLeftSec: optionalSeconds(al.everyoneLeftSec),
        waitingRoomSec: optionalSeconds(al.waitingRoomSec),
        noRecordingSec: optionalSeconds(al.noRecordingSec),
        nooneJoinedSec: optionalSeconds(al.nooneJoinedSec),
      };
    }

    // Avatar: explicit null clears it; { jpegB64 } sets it (validated); absent = no change.
    if (body.avatar === null) {
      await setBotAvatar(null);
    } else if (body.avatar !== undefined) {
      const avatar = body.avatar as { jpegB64?: unknown };
      if (typeof avatar.jpegB64 !== 'string' || avatar.jpegB64 === '') {
        return badRequest('avatar.jpegB64 must be a non-empty string, or send avatar: null to clear.');
      }
      const normalized = normalizeAvatar(avatar.jpegB64);
      if ('error' in normalized) return badRequest(normalized.error);
      await setBotAvatar(normalized.b64);
    }

    if (Object.keys(patch).length > 0) await setBotConfig(patch);

    return NextResponse.json({ config: toClient(await getBotConfig()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'bot_settings_write_failed', message } }, { status: 500 });
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}
