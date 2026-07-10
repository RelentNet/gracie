/**
 * P7 notification/email configuration read from `settings` + env, with defensive
 * defaults so the worker never boots into a half-configured state (docs/plan p7
 * §8). Scalar settings follow the stored format used across the app: `settings.value`
 * is jsonb holding a JSON STRING (e.g. `to_jsonb('true'::text)`); the reader takes
 * `typeof value === 'string' ? value : null` then parses.
 *
 * `RESEND_FROM` (§3/§7) resolves env-first, then the non-secret `config.from` on the
 * `resend` integration row, then a GA-domain default. It MUST be an address on the
 * Resend-verified domain (operator-provided) for live sends to succeed.
 */
import { getServerClient } from '@gracie/db';
import type { ServerClient } from '@gracie/db';

/** GA-domain fallback From. Live sends need a Resend-VERIFIED address (operator). */
const DEFAULT_RESEND_FROM = 'Gracie <gracie@graceandassociates.com>';
/** Deployed app origin (memory: gracie.graceandassociates.com) — used in email links. */
const DEFAULT_APP_BASE_URL = 'https://gracie.graceandassociates.com';

const DEFAULT_DAILY_SYNC_HOUR_ET = 6;
const DEFAULT_KB_EXPIRY_WARNING_DAYS = 14;
const DEFAULT_AT_RISK_HEALTH_THRESHOLD = 50;

/** Read a scalar string setting (or null when unset / non-string). */
async function readStringSetting(db: ServerClient, key: string): Promise<string | null> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error !== null) throw new Error(`notify-config: read setting ${key}: ${error.message}`);
  return typeof data?.value === 'string' ? data.value : null;
}

/** Parse a stored boolean-ish setting; defaults when unset/unparseable. */
function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

/** Parse a stored integer setting; defaults when unset/unparseable. */
function parseInt10(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Daily-sync scheduling/config. */
export interface DailySyncConfig {
  readonly enabled: boolean;
  /** Wall-clock hour in ET at which the digest sends (0–23). */
  readonly hourEt: number;
  readonly briefsEnabled: boolean;
}

/** Resolve daily-sync config from settings. */
export async function getDailySyncConfig(db: ServerClient): Promise<DailySyncConfig> {
  const [enabledRaw, hourRaw, briefsRaw] = await Promise.all([
    readStringSetting(db, 'daily_sync_enabled'),
    readStringSetting(db, 'daily_sync_hour_et'),
    readStringSetting(db, 'pre_meeting_briefs_enabled'),
  ]);
  const hour = parseInt10(hourRaw, DEFAULT_DAILY_SYNC_HOUR_ET);
  return {
    enabled: parseBool(enabledRaw, true),
    hourEt: hour >= 0 && hour <= 23 ? hour : DEFAULT_DAILY_SYNC_HOUR_ET,
    briefsEnabled: parseBool(briefsRaw, true),
  };
}

/** Days-before-expiry at which a KB doc triggers a `kb_expiring` alert. */
export async function getKbExpiryWarningDays(db: ServerClient): Promise<number> {
  const raw = await readStringSetting(db, 'kb_expiry_warning_days');
  const days = parseInt10(raw, DEFAULT_KB_EXPIRY_WARNING_DAYS);
  return days > 0 ? days : DEFAULT_KB_EXPIRY_WARNING_DAYS;
}

/** Relationship-health at-or-below which a client is "at risk" in the sync. */
export async function getAtRiskHealthThreshold(db: ServerClient): Promise<number> {
  const raw = await readStringSetting(db, 'at_risk_health_threshold');
  const t = parseInt10(raw, DEFAULT_AT_RISK_HEALTH_THRESHOLD);
  return t >= 0 && t <= 100 ? t : DEFAULT_AT_RISK_HEALTH_THRESHOLD;
}

/** The verified From address for outbound email (env → resend config → default). */
export async function getResendFrom(db: ServerClient): Promise<string> {
  const env = process.env.RESEND_FROM?.trim();
  if (env !== undefined && env !== '') return env;

  const { data, error } = await db
    .from('integration_credentials')
    .select('config')
    .eq('service', 'resend')
    .maybeSingle();
  if (error === null && data?.config !== null && typeof data?.config === 'object' && !Array.isArray(data.config)) {
    const from = (data.config as Record<string, unknown>).from;
    if (typeof from === 'string' && from.trim() !== '') return from.trim();
  }
  return DEFAULT_RESEND_FROM;
}

/** App base URL for email links (env override, else the deployed default). */
export function getAppBaseUrl(): string {
  const env = process.env.APP_BASE_URL?.trim();
  return env !== undefined && env !== '' ? env : DEFAULT_APP_BASE_URL;
}

/** A DB handle for the helpers above (convenience for callers with none). */
export function notifyConfigDb(): ServerClient {
  return getServerClient();
}
