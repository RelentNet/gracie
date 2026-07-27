/**
 * Admin-only daily-sync template settings (Settings → Daily Sync, DS).
 *
 *   GET   → `{ settings: { template, aiPrompt, aiEnabled } }`
 *   PATCH → `{ template?, aiPrompt?, aiEnabled? }` → `{ settings }`
 *
 * Both Admin only (mirrors the Generation Prompts / Company routes); a non-admin
 * receives 403 on read AND write. A blank / unchanged-from-default template or prompt
 * resets that field to its default.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import {
  DailySyncSettingsValidationError,
  getDailySyncSettings,
  setDailySyncSettings,
  type DailySyncSettingsPatch,
} from '@/lib/data/daily-sync-settings';

// @gracie/db (service-role client) is Node-only.
export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
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
    return NextResponse.json({ settings: await getDailySyncSettings() });
  } catch (error) {
    return jsonError('daily_sync_settings_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: { template?: string; aiPrompt?: string; aiEnabled?: boolean } = {};
    if (body.template !== undefined) patch.template = body.template as string;
    if (body.aiPrompt !== undefined) patch.aiPrompt = body.aiPrompt as string;
    if (body.aiEnabled !== undefined) patch.aiEnabled = body.aiEnabled as boolean;
    if (patch.template === undefined && patch.aiPrompt === undefined && patch.aiEnabled === undefined) {
      return jsonError('bad_request', 'Provide template, aiPrompt, and/or aiEnabled', 400);
    }
    try {
      return NextResponse.json({ settings: await setDailySyncSettings(patch as DailySyncSettingsPatch) });
    } catch (err) {
      if (err instanceof DailySyncSettingsValidationError) return jsonError('bad_request', err.message, 400);
      throw err;
    }
  } catch (error) {
    return jsonError('daily_sync_settings_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
