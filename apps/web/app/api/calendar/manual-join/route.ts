/**
 * Global master switch for on-demand meeting join (P4.2). INDEPENDENT of the auto
 * kill-switch at /api/calendar/settings: that gates the AUTOMATIC dispatch cron;
 * this gates the EXPLICIT "paste a link → Gracie joins now" action. Fail-safe: the
 * flag is OFF unless explicitly set.
 *
 *   GET   → `{ enabled }` — readable by ANY authenticated user, so their UI knows
 *           whether to show the "Join a meeting" control.
 *   PATCH → `{ enabled: boolean }` flips it — Admin only (docs/02 §D14).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getManualJoinEnabled, setManualJoinEnabled } from '@/lib/data/calendar';

// @gracie/db (service-role client) is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    await getRequestUser(); // any authenticated user; rejects a missing session
    const enabled = await getManualJoinEnabled();
    return NextResponse.json({ enabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'unauthorized' ? 401 : 500;
    return NextResponse.json({ error: { code: 'manual_join_read_failed', message } }, { status });
  }
}

interface ManualJoinBody {
  readonly enabled?: unknown;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as ManualJoinBody;
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'enabled (boolean) is required' } },
        { status: 400 },
      );
    }
    const enabled = await setManualJoinEnabled(body.enabled);
    return NextResponse.json({ enabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'unauthorized' ? 401 : 500;
    return NextResponse.json({ error: { code: 'manual_join_write_failed', message } }, { status });
  }
}
