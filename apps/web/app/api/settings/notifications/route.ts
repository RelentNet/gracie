/**
 * Admin-only notification & communication settings (Settings → Notifications).
 * Controls which of Gracie's INTERNAL emails go out. The `@graceandassociates.com`
 * allowlist is returned READ-ONLY (never widenable here — §3 hard safety); this
 * route only flips team-facing email toggles.
 *
 *   GET   → `{ settings }` (toggles + read-only allowedDomains)
 *   PATCH → `{ dailySyncEnabled?, briefsEnabled?, alerts?: {…} }` → updated settings
 *
 * Both are Admin only (docs/02 §D14); non-admins receive a 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getNotificationSettings, setNotificationSettings } from '@/lib/data/notification-settings';

// @gracie/db (service-role client) is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

function forbidden(): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 });
}

export async function GET(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    return NextResponse.json({ settings: await getNotificationSettings() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'notification_settings_read_failed', message } }, { status: 500 });
  }
}

interface PatchBody {
  readonly dailySyncEnabled?: unknown;
  readonly briefsEnabled?: unknown;
  readonly alerts?: unknown;
}

/** Coerce a value to boolean, or return undefined (leave unchanged) / error. */
function asBool(value: unknown, field: string): boolean | { error: string } {
  if (typeof value !== 'boolean') return { error: `${field} must be a boolean.` };
  return value;
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) return forbidden();
    const body = (await request.json().catch(() => ({}))) as PatchBody;

    const patch: {
      dailySyncEnabled?: boolean;
      briefsEnabled?: boolean;
      alerts?: {
        pipelineFailed?: boolean;
        needsAttention?: boolean;
        calendarDisconnect?: boolean;
        kbExpiring?: boolean;
      };
    } = {};

    if (body.dailySyncEnabled !== undefined) {
      const v = asBool(body.dailySyncEnabled, 'dailySyncEnabled');
      if (typeof v !== 'boolean') return badRequest(v.error);
      patch.dailySyncEnabled = v;
    }
    if (body.briefsEnabled !== undefined) {
      const v = asBool(body.briefsEnabled, 'briefsEnabled');
      if (typeof v !== 'boolean') return badRequest(v.error);
      patch.briefsEnabled = v;
    }
    if (body.alerts !== undefined) {
      if (body.alerts === null || typeof body.alerts !== 'object' || Array.isArray(body.alerts)) {
        return badRequest('alerts must be an object.');
      }
      const a = body.alerts as Record<string, unknown>;
      const alerts: {
        pipelineFailed?: boolean;
        needsAttention?: boolean;
        calendarDisconnect?: boolean;
        kbExpiring?: boolean;
      } = {};
      for (const key of ['pipelineFailed', 'needsAttention', 'calendarDisconnect', 'kbExpiring'] as const) {
        if (a[key] !== undefined) {
          const v = asBool(a[key], `alerts.${key}`);
          if (typeof v !== 'boolean') return badRequest(v.error);
          alerts[key] = v;
        }
      }
      patch.alerts = alerts;
    }

    return NextResponse.json({ settings: await setNotificationSettings(patch) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'notification_settings_write_failed', message } }, { status: 500 });
  }
}
