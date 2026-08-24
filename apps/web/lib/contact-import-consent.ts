/**
 * Outlook-contact-import consent allow-list — the PURE logic (no DB, no
 * `server-only`), so it is unit-testable and shared by the data layer + routes.
 *
 * The store is a single `settings` row (`outlook_contact_import_consent`) whose
 * value is a JSON `string[]` of LOWER-CASED mailbox emails that have opted in.
 * Empty / missing / unparseable ⇒ DEFAULT DENY (nobody allowed). The Azure
 * `Contacts.Read` app permission is tenant-wide, so this list is the only thing
 * standing between an admin and reading any colleague's mailbox — treat it as a
 * trust boundary and always gate the import against `isConsented`.
 */

/** Trim + lower-case a mailbox for comparison/storage. */
export function normalizeMailbox(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize + dedupe a raw list, dropping blanks and anything without an '@'. */
function clean(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const m = normalizeMailbox(item);
    if (m === '' || !m.includes('@')) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** Parse a stored settings value (JSON string) into a normalized allow-list. */
export function parseConsentList(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // corrupt value ⇒ default deny, never throw
  }
  return Array.isArray(parsed) ? clean(parsed) : [];
}

/** Serialize an allow-list back to the stored JSON-string form (normalized). */
export function serializeConsentList(list: readonly string[]): string {
  return JSON.stringify(clean(list));
}

/** True iff `mailbox` is on the allow-list (case-insensitive, robust to un-normalized lists). */
export function isConsented(mailbox: string, list: readonly string[]): boolean {
  const m = normalizeMailbox(mailbox);
  if (m === '') return false;
  return list.some((e) => normalizeMailbox(e) === m);
}

/** Return a new list with `mailbox` added (normalized, deduped). No-op if already present. */
export function addToAllowlist(list: readonly string[], mailbox: string): string[] {
  return clean([...list, mailbox]);
}

/** Return a new list with `mailbox` removed (case-insensitive). Every other entry is untouched. */
export function removeFromAllowlist(list: readonly string[], mailbox: string): string[] {
  const m = normalizeMailbox(mailbox);
  return clean(list).filter((e) => e !== m);
}

/**
 * Flip exactly ONE mailbox on/off. Used by the self-serve route, which passes the
 * SESSION user's own email — so this is the single place proving a consent write
 * only ever touches the one intended address (see the unit test).
 */
export function applyConsent(list: readonly string[], mailbox: string, allow: boolean): string[] {
  return allow ? addToAllowlist(list, mailbox) : removeFromAllowlist(list, mailbox);
}
