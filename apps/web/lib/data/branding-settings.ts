/**
 * Brand-logo settings data layer (Settings → Company → Branding). Two SQL-only
 * settings holding MinIO object keys of the nav logo:
 *   - `brand_logo_key`      — the main (light-theme) logo.
 *   - `brand_logo_dark_key` — an OPTIONAL dark-theme variant, for logos that wash
 *     out on the dark surface. Unset → the main logo is used in both themes.
 * Empty string = unset → the nav keeps its default text treatment (main) or
 * reuses the main logo (dark).
 *
 * Stored as plain string values (matching the scalar-string settings pattern:
 * `internal_email_domains`, the boolean toggles). No migration — the `settings`
 * table already exists.
 *
 * Server-only (service-role client); permission enforcement is the API's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

const BRAND_LOGO_KEY = 'brand_logo_key';
const BRAND_LOGO_DARK_KEY = 'brand_logo_dark_key';

/** Read a scalar brand-logo setting's object key, or null when unset/blank. */
async function readKey(settingKey: string): Promise<string | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', settingKey)
    .maybeSingle();
  if (error !== null) throw new Error(`getBrandLogoKey(${settingKey}): ${error.message}`);
  const v = data?.value;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Persist a scalar brand-logo setting's object key ('' clears it). */
async function writeKey(settingKey: string, key: string, updatedByUserId: string | null): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('settings').upsert(
    {
      key: settingKey,
      value: key,
      updated_by_user_id: updatedByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setBrandLogoKey(${settingKey}): ${error.message}`);
}

/** Read the current brand-logo object key, or null when unset. */
export function getBrandLogoKey(): Promise<string | null> {
  return readKey(BRAND_LOGO_KEY);
}

/** Persist the brand-logo object key ('' clears it). Admin-gated at the route. */
export function setBrandLogoKey(key: string, updatedByUserId: string | null): Promise<void> {
  return writeKey(BRAND_LOGO_KEY, key, updatedByUserId);
}

/** Read the optional dark-theme brand-logo object key, or null when unset. */
export function getBrandLogoDarkKey(): Promise<string | null> {
  return readKey(BRAND_LOGO_DARK_KEY);
}

/** Persist the dark-theme brand-logo object key ('' clears it). Admin-gated at the route. */
export function setBrandLogoDarkKey(key: string, updatedByUserId: string | null): Promise<void> {
  return writeKey(BRAND_LOGO_DARK_KEY, key, updatedByUserId);
}
