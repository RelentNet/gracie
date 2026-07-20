/**
 * Documents recycle-bin settings (server-only).
 *
 * Both values are seeded by migration 0012 and read — never cached — so an operator
 * change takes effect without a redeploy. The UI reads retention through here too, so
 * the countdown a user sees is always the window the purge sweep will actually apply.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

const RETENTION_SETTING_KEY = 'documents_trash_retention_days';

/** Matches the seeded default in migration 0012. */
export const DEFAULT_TRASH_RETENTION_DAYS = 60;

/** Never purge same-day, however the setting is mis-typed. */
const MIN_RETENTION_DAYS = 1;

/**
 * Days a soft-deleted item stays in the recycle bin before the purge sweep destroys
 * it. Clamped at a 1-day floor: a stray `0` in settings would otherwise make delete
 * effectively immediate and irreversible, which is exactly what the bin exists to
 * prevent.
 */
export async function getTrashRetentionDays(): Promise<number> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', RETENTION_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getTrashRetentionDays: ${error.message}`);
  const raw = typeof data?.value === 'string' ? Number.parseInt(data.value.trim(), 10) : NaN;
  const days = Number.isFinite(raw) ? raw : DEFAULT_TRASH_RETENTION_DAYS;
  return Math.max(days, MIN_RETENTION_DAYS);
}
