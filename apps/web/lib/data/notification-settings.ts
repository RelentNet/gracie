/**
 * Notification & communication settings (Settings → Notifications). Admin-only
 * control over which of Gracie's INTERNAL emails go out. Gracie only ever emails
 * `@graceandassociates.com` (the hard allowlist enforced in the worker's send
 * choke-point) — she never contacts customers — so this surface only toggles
 * team-facing emails and displays the allowlist READ-ONLY.
 *
 * Booleans are stored as JSON strings ('true'/'false') to match the worker's
 * `notify-config` reader (`typeof value === 'string' ? value : null` → parseBool).
 * Server-only (service-role client); permission enforcement is the API layer's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';

/** GA floor shown when `email_allowed_domains` is unset (mirrors the worker floor). */
const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ['graceandassociates.com'];

/** Setting keys behind each toggle (must match the worker's readers exactly). */
const KEYS = {
  dailySyncEnabled: 'daily_sync_enabled',
  briefsEnabled: 'pre_meeting_briefs_enabled',
  pipelineFailed: 'alert_pipeline_failed_enabled',
  needsAttention: 'alert_needs_attention_enabled',
  calendarDisconnect: 'alert_calendar_disconnect_enabled',
  kbExpiring: 'alert_kb_expiring_enabled',
} as const;

const ALLOWLIST_KEY = 'email_allowed_domains';

export interface NotificationSettings {
  readonly dailySyncEnabled: boolean;
  readonly briefsEnabled: boolean;
  readonly alerts: {
    readonly pipelineFailed: boolean;
    readonly needsAttention: boolean;
    readonly calendarDisconnect: boolean;
    readonly kbExpiring: boolean;
  };
  /** Read-only: the domains Gracie is allowed to email. Never widenable here. */
  readonly allowedDomains: readonly string[];
}

/** Patch of toggles to update; the allowlist is intentionally NOT settable here. */
export interface NotificationSettingsPatch {
  readonly dailySyncEnabled?: boolean;
  readonly briefsEnabled?: boolean;
  readonly alerts?: {
    readonly pipelineFailed?: boolean;
    readonly needsAttention?: boolean;
    readonly calendarDisconnect?: boolean;
    readonly kbExpiring?: boolean;
  };
}

/** Parse a stored boolean-ish setting; defaults ON when unset/unparseable. */
function parseBool(value: unknown, fallback = true): boolean {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

/** Parse the comma-separated allowlist string; falls back to the GA floor. */
function parseAllowedDomains(value: unknown): string[] {
  if (typeof value !== 'string') return [...DEFAULT_ALLOWED_DOMAINS];
  const domains = value
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
  return domains.length > 0 ? domains : [...DEFAULT_ALLOWED_DOMAINS];
}

/** Read all notification toggles + the read-only allowlist (defaults ON). */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const db = getServerClient();
  const keys = [...Object.values(KEYS), ALLOWLIST_KEY];
  const { data, error } = await db.from('settings').select('key, value').in('key', keys);
  if (error !== null) throw new Error(`getNotificationSettings: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    dailySyncEnabled: parseBool(byKey.get(KEYS.dailySyncEnabled)),
    briefsEnabled: parseBool(byKey.get(KEYS.briefsEnabled)),
    alerts: {
      pipelineFailed: parseBool(byKey.get(KEYS.pipelineFailed)),
      needsAttention: parseBool(byKey.get(KEYS.needsAttention)),
      calendarDisconnect: parseBool(byKey.get(KEYS.calendarDisconnect)),
      kbExpiring: parseBool(byKey.get(KEYS.kbExpiring)),
    },
    allowedDomains: parseAllowedDomains(byKey.get(ALLOWLIST_KEY)),
  };
}

/**
 * Update the provided toggles (only). Stores each as the JSON string 'true'/'false'
 * so the worker's reader sees the expected format. Returns the full fresh settings.
 * Admin-gated at the API layer. The allowlist is never written here (§3 safety).
 */
export async function setNotificationSettings(
  patch: NotificationSettingsPatch,
): Promise<NotificationSettings> {
  const db = getServerClient();

  const rows: Array<{ key: string; value: string }> = [];
  const push = (key: string, val: boolean | undefined): void => {
    if (val !== undefined) rows.push({ key, value: val ? 'true' : 'false' });
  };
  push(KEYS.dailySyncEnabled, patch.dailySyncEnabled);
  push(KEYS.briefsEnabled, patch.briefsEnabled);
  push(KEYS.pipelineFailed, patch.alerts?.pipelineFailed);
  push(KEYS.needsAttention, patch.alerts?.needsAttention);
  push(KEYS.calendarDisconnect, patch.alerts?.calendarDisconnect);
  push(KEYS.kbExpiring, patch.alerts?.kbExpiring);

  if (rows.length > 0) {
    await upsertSettings(db, rows);
  }
  return getNotificationSettings();
}

/** Upsert scalar settings rows (value is jsonb holding a JSON string). */
async function upsertSettings(
  db: ServerClient,
  rows: ReadonlyArray<{ key: string; value: string }>,
): Promise<void> {
  const { error } = await db
    .from('settings')
    .upsert(rows as Array<{ key: string; value: string }>, { onConflict: 'key' });
  if (error !== null) throw new Error(`setNotificationSettings: ${error.message}`);
}
