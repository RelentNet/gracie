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

import { resolveBrandPreset } from '../brand-presets';

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

/**
 * The selected brand preset id (`lib/brand-presets.ts`) and an OPTIONAL product-name
 * override. Same scalar-string settings pattern as the logo keys — no migration.
 *
 * The preset supplies a product name of its own; the override exists so an operator
 * can keep a preset's palette while calling the product something else. Empty ⇒ unset
 * ⇒ the preset's own name wins.
 */
const BRAND_PRESET_ID = 'brand_preset_id';
const BRAND_PRODUCT_NAME = 'brand_product_name';

/** Read the selected preset id, or null when never set (⇒ the default preset). */
export function getBrandPresetId(): Promise<string | null> {
  return readKey(BRAND_PRESET_ID);
}

/** Persist the selected preset id. Admin-gated at the route. */
export function setBrandPresetId(id: string, updatedByUserId: string | null): Promise<void> {
  return writeKey(BRAND_PRESET_ID, id, updatedByUserId);
}

/** Read the product-name override, or null when unset (⇒ the preset's own name). */
export function getBrandProductName(): Promise<string | null> {
  return readKey(BRAND_PRODUCT_NAME);
}

/** Persist the product-name override ('' clears it). Admin-gated at the route. */
export function setBrandProductName(name: string, updatedByUserId: string | null): Promise<void> {
  return writeKey(BRAND_PRODUCT_NAME, name, updatedByUserId);
}

/**
 * The product name in force: the override when set, else the selected preset's own
 * name. The single source for both the root layout and any server component that
 * needs to name the product in copy.
 */
export async function getActiveProductName(): Promise<string> {
  const [presetId, override] = await Promise.all([
    getBrandPresetId().catch(() => null),
    getBrandProductName().catch(() => null),
  ]);
  return override ?? resolveBrandPreset(presetId).productName;
}
