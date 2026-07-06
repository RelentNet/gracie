/**
 * Admin-only global calendar-bot controls (P4 kill-switch). Governs whether the
 * worker auto-joins ANY meeting, team-wide — distinct from the per-user opt-out
 * at /api/calendar/auto-join. Fail-safe: the flag is OFF unless explicitly set.
 *
 *   GET   → `{ botDispatchEnabled }` (current global state).
 *   PATCH → `{ enabled: boolean }` flips it, returns the new `{ botDispatchEnabled }`.
 *
 * Both are Admin only (docs/02 §D14); non-admins receive a 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getBotDispatchEnabled, setBotDispatchEnabled } from '@/lib/data/calendar';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

export async function GET(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const botDispatchEnabled = await getBotDispatchEnabled();
    return NextResponse.json({ botDispatchEnabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'calendar_settings_read_failed', message } },
      { status: 500 },
    );
  }
}

interface SettingsBody {
  readonly enabled?: unknown;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const body = (await request.json().catch(() => ({}))) as SettingsBody;
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'enabled (boolean) is required' } },
        { status: 400 },
      );
    }
    const botDispatchEnabled = await setBotDispatchEnabled(body.enabled);
    return NextResponse.json({ botDispatchEnabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'calendar_settings_write_failed', message } },
      { status: 500 },
    );
  }
}
