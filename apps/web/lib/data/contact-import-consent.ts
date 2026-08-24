/**
 * Outlook-contact-import consent store (Settings → Contacts + self-serve My
 * Settings). A single SQL-only `settings` row holds the allow-list as a JSON
 * `string[]` of lower-cased mailbox emails that have opted in. No migration — the
 * `settings` table already exists (same pattern as `internal_email_domains` /
 * the brand-logo keys). Empty / missing ⇒ default deny.
 *
 * The pure list logic (normalize/dedupe/add/remove/isConsented) lives in
 * `../contact-import-consent` and is unit-tested there; this module is only the
 * read/write path (service-role client). Permission enforcement is the route's job.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

import { applyConsent, parseConsentList, serializeConsentList } from '../contact-import-consent';

const CONSENT_KEY = 'outlook_contact_import_consent';

/** The current allow-list (normalized, deduped). Empty when unset. */
export async function getConsentList(): Promise<string[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', CONSENT_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`getConsentList: ${error.message}`);
  return parseConsentList(data?.value);
}

/** Persist a full allow-list, returning the normalized stored form. */
async function writeConsentList(
  list: readonly string[],
  updatedByUserId: string | null,
): Promise<string[]> {
  const db = getServerClient();
  const value = serializeConsentList(list);
  const { error } = await db.from('settings').upsert(
    {
      key: CONSENT_KEY,
      value,
      updated_by_user_id: updatedByUserId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
  if (error !== null) throw new Error(`writeConsentList: ${error.message}`);
  return parseConsentList(value);
}

/**
 * Flip ONE mailbox on/off and persist. Read-modify-write on the single row.
 * ponytail: last-write-wins — fine for a rarely-edited firm-wide settings row;
 * add row-level locking only if concurrent admin edits ever actually collide.
 */
export async function setConsent(
  mailbox: string,
  allow: boolean,
  updatedByUserId: string | null,
): Promise<string[]> {
  const current = await getConsentList();
  return writeConsentList(applyConsent(current, mailbox, allow), updatedByUserId);
}
