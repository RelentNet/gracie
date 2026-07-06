/**
 * Calendar → client matching + cross-attendee dedup (P4, docs/09 Phase 4).
 *
 * Deliberately SIMPLE (the brief: "start with simple alias + domain matching; do
 * NOT build fuzzy NLP"). A meeting matches a client when either:
 *   (a) a `client_aliases` alias (or the client's canonical name) appears as a
 *       whole word in the event subject, or
 *   (b) an attendee's email domain equals the client's `primary_contact_email`
 *       domain.
 * The union of both signals is the candidate set. The caller maps
 *   0 candidates → not a client meeting (skip),
 *   1 candidate  → assign that client,
 *   >1 candidates → ambiguous (`client_id = null`, Admin assigns).
 *
 * Pure + dependency-free (no DB/Graph) so it is trivially unit-testable.
 */

/** Lower-case + collapse whitespace for subject/alias comparison. */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Extract the lower-cased domain from an email address, or null. */
export function emailDomain(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain === '' ? null : domain;
}

/** One alias needle bound to its client (aliases + the client's canonical name). */
export interface AliasEntry {
  readonly clientId: string;
  readonly needle: string;
}

/** One domain bound to its client (from `primary_contact_email`). */
export interface DomainEntry {
  readonly clientId: string;
  readonly domain: string;
}

/** Precomputed matcher tables built once per scan from the client roster. */
export interface ClientMatchers {
  readonly aliases: readonly AliasEntry[];
  readonly domains: readonly DomainEntry[];
}

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the matcher tables. `clients` supplies canonical names + contact emails;
 * `aliases` supplies the extra alias strings. Needles shorter than 2 chars are
 * dropped (too collision-prone for a substring match).
 */
export function buildClientMatchers(
  clients: ReadonlyArray<{ id: string; name: string; primaryContactEmail: string | null }>,
  aliases: ReadonlyArray<{ clientId: string; alias: string }>,
): ClientMatchers {
  const aliasEntries: AliasEntry[] = [];
  const seen = new Set<string>();
  const pushAlias = (clientId: string, raw: string): void => {
    const needle = normalizeText(raw);
    if (needle.length < 2) return;
    const key = `${clientId}::${needle}`;
    if (seen.has(key)) return;
    seen.add(key);
    aliasEntries.push({ clientId, needle });
  };
  for (const c of clients) pushAlias(c.id, c.name);
  for (const a of aliases) pushAlias(a.clientId, a.alias);

  const domainEntries: DomainEntry[] = [];
  for (const c of clients) {
    const domain = emailDomain(c.primaryContactEmail);
    if (domain !== null) domainEntries.push({ clientId: c.id, domain });
  }

  return { aliases: aliasEntries, domains: domainEntries };
}

/** Client ids whose alias/name appears as a whole word in the subject. */
export function matchClientsBySubject(
  subject: string | null,
  matchers: ClientMatchers,
): Set<string> {
  const hits = new Set<string>();
  if (subject === null) return hits;
  const haystack = normalizeText(subject);
  if (haystack === '') return hits;
  for (const entry of matchers.aliases) {
    // Whole-word (boundary) match so "CMS" doesn't match "CMSomething"; falls
    // back to substring for multi-word needles containing punctuation.
    const boundary = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(entry.needle)}(?:$|[^a-z0-9])`);
    if (boundary.test(haystack)) hits.add(entry.clientId);
  }
  return hits;
}

/** Client ids whose contact domain matches any attendee's email domain. */
export function matchClientsByDomain(
  attendeeEmails: readonly (string | null)[],
  matchers: ClientMatchers,
): Set<string> {
  const hits = new Set<string>();
  const domains = new Set<string>();
  for (const email of attendeeEmails) {
    const d = emailDomain(email);
    if (d !== null) domains.add(d);
  }
  for (const entry of matchers.domains) {
    if (domains.has(entry.domain)) hits.add(entry.clientId);
  }
  return hits;
}

/** Union of subject + domain matches — the candidate client set for an event. */
export function resolveClientCandidates(
  event: { subject: string | null; attendeeEmails: readonly (string | null)[] },
  matchers: ClientMatchers,
): string[] {
  const union = new Set<string>([
    ...matchClientsBySubject(event.subject, matchers),
    ...matchClientsByDomain(event.attendeeEmails, matchers),
  ]);
  return [...union];
}

/**
 * Stable cross-attendee dedup key stored in `meetings.calendar_event_id`. The
 * SAME meeting on two members' calendars has different per-mailbox event ids but
 * the same key, so an upsert on `calendar_event_id` collapses them to one row:
 *   1. `iCalUId` — Graph's cross-mailbox meeting id (best signal),
 *   2. else the normalized join URL,
 *   3. else `start instant + sorted attendee emails` (last resort).
 */
export function meetingDedupKey(event: {
  iCalUId: string | null;
  joinUrl: string | null;
  startUtc: string | null;
  attendeeEmails: readonly (string | null)[];
}): string {
  if (event.iCalUId !== null && event.iCalUId !== '') return `ical:${event.iCalUId}`;
  if (event.joinUrl !== null && event.joinUrl !== '') {
    return `join:${event.joinUrl.trim().toLowerCase()}`;
  }
  const emails = event.attendeeEmails
    .filter((e): e is string => e !== null && e !== '')
    .map((e) => e.toLowerCase())
    .sort()
    .join(',');
  return `sig:${event.startUtc ?? 'unknown'}|${emails}`;
}
