/**
 * Admin-only automations settings (Settings → Automations). Controls:
 *  - the customer-contact EXCEPTION master switch (`automations_external_send_enabled`,
 *    default OFF) — while OFF, no automation may email an external (non-GA) recipient.
 *  - the recurring-interval floor (`automations_min_interval_minutes`, default 60, P9) —
 *    the minimum interval a recurring automation may use.
 *
 *   GET   → `{ externalSendEnabled, minIntervalMinutes, minIntervalBounds }`
 *   PATCH → `{ externalSendEnabled?, minIntervalMinutes? }` → updated values
 *
 * Both are Admin only (docs/02 §D14); non-admins receive a 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { ABSOLUTE_MIN_INTERVAL_MINUTES } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import {
  getAutomationsExternalSendEnabled,
  getAutomationsMinIntervalMinutes,
  setAutomationsExternalSendEnabled,
  setAutomationsMinIntervalMinutes,
  MAX_MIN_INTERVAL_MINUTES,
} from '@/lib/data/automations';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function readSettings(): Promise<{
  externalSendEnabled: boolean;
  minIntervalMinutes: number;
  minIntervalBounds: { min: number; max: number };
}> {
  const [externalSendEnabled, minIntervalMinutes] = await Promise.all([
    getAutomationsExternalSendEnabled(),
    getAutomationsMinIntervalMinutes(),
  ]);
  return {
    externalSendEnabled,
    minIntervalMinutes,
    minIntervalBounds: { min: ABSOLUTE_MIN_INTERVAL_MINUTES, max: MAX_MIN_INTERVAL_MINUTES },
  };
}

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  try {
    return NextResponse.json(await readSettings());
  } catch (error) {
    return jsonError('automations_settings_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const hasExternal = body.externalSendEnabled !== undefined;
    const hasInterval = body.minIntervalMinutes !== undefined;
    if (!hasExternal && !hasInterval) {
      return jsonError('bad_request', 'Provide externalSendEnabled and/or minIntervalMinutes', 400);
    }

    // `user.userId` is the Logto id; settings.updated_by_user_id is the internal
    // users.id (uuid) — resolve it (null when unsynced) before stamping.
    const byUserId = await getUserIdByLogtoId(user.userId);

    if (hasExternal) {
      if (typeof body.externalSendEnabled !== 'boolean') {
        return jsonError('bad_request', 'externalSendEnabled must be a boolean', 400);
      }
      await setAutomationsExternalSendEnabled(body.externalSendEnabled, byUserId);
    }

    if (hasInterval) {
      if (typeof body.minIntervalMinutes !== 'number' || !Number.isFinite(body.minIntervalMinutes)) {
        return jsonError('bad_request', 'minIntervalMinutes must be a number', 400);
      }
      if (
        body.minIntervalMinutes < ABSOLUTE_MIN_INTERVAL_MINUTES ||
        body.minIntervalMinutes > MAX_MIN_INTERVAL_MINUTES
      ) {
        return jsonError(
          'bad_request',
          `minIntervalMinutes must be between ${ABSOLUTE_MIN_INTERVAL_MINUTES} and ${MAX_MIN_INTERVAL_MINUTES}`,
          400,
        );
      }
      await setAutomationsMinIntervalMinutes(body.minIntervalMinutes, byUserId);
    }

    return NextResponse.json(await readSettings());
  } catch (error) {
    return jsonError('automations_settings_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
