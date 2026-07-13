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

/** Numeric timing/threshold keys (must match the worker's notify-config readers). */
const TIMING_KEYS = {
  dailySyncHourEt: 'daily_sync_hour_et',
  kbExpiryWarningDays: 'kb_expiry_warning_days',
  atRiskHealthThreshold: 'at_risk_health_threshold',
} as const;

/** Defaults + inclusive bounds for the numeric timing settings (mirror notify-config.ts). */
export const TIMING_SPEC = {
  dailySyncHourEt: { default: 6, min: 0, max: 23 },
  kbExpiryWarningDays: { default: 14, min: 1, max: 365 },
  atRiskHealthThreshold: { default: 50, min: 0, max: 100 },
} as const;

const ALLOWLIST_KEY = 'email_allowed_domains';

export interface NotificationTiming {
  /** Hour (ET, 0–23) the daily-sync email fires. */
  readonly dailySyncHourEt: number;
  /** Days-before-expiry a KB doc triggers a `kb_expiring` alert. */
  readonly kbExpiryWarningDays: number;
  /** Health score at/under which a client is "at risk" in the daily sync (0–100). */
  readonly atRiskHealthThreshold: number;
}

export interface NotificationSettings {
  readonly dailySyncEnabled: boolean;
  readonly briefsEnabled: boolean;
  readonly alerts: {
    readonly pipelineFailed: boolean;
    readonly needsAttention: boolean;
    readonly calendarDisconnect: boolean;
    readonly kbExpiring: boolean;
  };
  readonly timing: NotificationTiming;
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
  readonly timing?: {
    readonly dailySyncHourEt?: number;
    readonly kbExpiryWarningDays?: number;
    readonly atRiskHealthThreshold?: number;
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

/** Parse a stored integer setting, clamping into [min,max]; defaults when unset/unparseable. */
function parseIntSetting(value: unknown, spec: { default: number; min: number; max: number }): number {
  if (typeof value !== 'string') return spec.default;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n)) return spec.default;
  return Math.min(Math.max(n, spec.min), spec.max);
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
  const keys = [...Object.values(KEYS), ...Object.values(TIMING_KEYS), ALLOWLIST_KEY];
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
    timing: {
      dailySyncHourEt: parseIntSetting(byKey.get(TIMING_KEYS.dailySyncHourEt), TIMING_SPEC.dailySyncHourEt),
      kbExpiryWarningDays: parseIntSetting(byKey.get(TIMING_KEYS.kbExpiryWarningDays), TIMING_SPEC.kbExpiryWarningDays),
      atRiskHealthThreshold: parseIntSetting(
        byKey.get(TIMING_KEYS.atRiskHealthThreshold),
        TIMING_SPEC.atRiskHealthThreshold,
      ),
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

  // Numeric timing/thresholds — stored as JSON strings, clamped to their bounds so a
  // bad value never reaches the worker (mirrors the worker's own defensive parse).
  const pushInt = (
    key: string,
    val: number | undefined,
    spec: { default: number; min: number; max: number },
  ): void => {
    if (val === undefined) return;
    const n = Number.isFinite(val) ? Math.min(Math.max(Math.round(val), spec.min), spec.max) : spec.default;
    rows.push({ key, value: String(n) });
  };
  pushInt(TIMING_KEYS.dailySyncHourEt, patch.timing?.dailySyncHourEt, TIMING_SPEC.dailySyncHourEt);
  pushInt(TIMING_KEYS.kbExpiryWarningDays, patch.timing?.kbExpiryWarningDays, TIMING_SPEC.kbExpiryWarningDays);
  pushInt(TIMING_KEYS.atRiskHealthThreshold, patch.timing?.atRiskHealthThreshold, TIMING_SPEC.atRiskHealthThreshold);

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
