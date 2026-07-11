/**
 * Admin-only automations settings (Settings → Automations). Controls the
 * customer-contact EXCEPTION master switch (`automations_external_send_enabled`,
 * default OFF). While OFF, no automation may email an external (non-GA) recipient —
 * the P7 GA-only floor stands for every send.
 *
 *   GET   → `{ externalSendEnabled }`
 *   PATCH → `{ externalSendEnabled: boolean }` → updated value
 *
 * Both are Admin only (docs/02 §D14); non-admins receive a 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import {
  getAutomationsExternalSendEnabled,
  setAutomationsExternalSendEnabled,
} from '@/lib/data/automations';

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
    return NextResponse.json({ externalSendEnabled: await getAutomationsExternalSendEnabled() });
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
    if (typeof body.externalSendEnabled !== 'boolean') {
      return jsonError('bad_request', 'externalSendEnabled (boolean) is required', 400);
    }
    const externalSendEnabled = await setAutomationsExternalSendEnabled(body.externalSendEnabled, user.userId);
    return NextResponse.json({ externalSendEnabled });
  } catch (error) {
    return jsonError('automations_settings_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
