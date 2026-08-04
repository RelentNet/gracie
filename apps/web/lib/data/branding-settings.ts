/**
 * Brand-logo settings data layer (Settings → Company → Branding). A single
 * SQL-only setting, `brand_logo_key`, holding the MinIO object key of the nav
 * logo. Empty string = no logo → the nav keeps its default text treatment.
 *
 * Stored as a plain string value (matching the scalar-string settings pattern:
 * `internal_email_domains`, the boolean toggles). No migration — the `settings`
 * table already exists.
 *
 * Server-only (service-role client); permission enforcement is the API's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

const BRAND_LOGO_KEY = 'brand_logo_key';

/** Read the current brand-logo object key, or null when unset. */
export async function getBrandLogoKey(): Promise<string | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', BRAND_LOGO_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getBrandLogoKey: ${error.message}`);
  const v = data?.value;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Persist the brand-logo object key ('' clears it). Admin-gated at the route. */
export async function setBrandLogoKey(key: string, updatedByUserId: string | null): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('settings').upsert(
    {
      key: BRAND_LOGO_KEY,
      value: key,
      updated_by_user_id: updatedByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`setBrandLogoKey: ${error.message}`);
}
