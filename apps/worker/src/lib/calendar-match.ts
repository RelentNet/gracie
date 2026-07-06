/**
 * Calendar → org matching + cross-attendee dedup (P4.1, docs/plan
 * p4.1-meetings-first-orgs.md §4).
 *
 * DOMAIN-FIRST. A meeting's org(s) are derived from the external email domains of
 * its attendees + organizer — everything except Grace & Associates' own internal
 * domain(s) and public free-email providers. A domain that maps to a
 * `client_domains` row links the meeting to that org; multiple external domains
 * ⇒ a multi-client meeting; an external domain with no org is "unknown" (offer
 * "create client / lead"). A meeting whose every participant is on an internal
 * domain is `internal` (linked to the GA org). Free-email participants are
 * surfaced (so a user can create a lead + attach them) but never an org domain.
 *
 * Pure + dependency-free (no DB/Graph) so it is trivially unit-testable. The
 * free-email list and email/domain helpers live in `@gracie/shared` (one source
 * of truth shared with the web layer).
 */
import { emailDomain, isFreeEmailDomain, type ExternalAttendee } from '@gracie/shared';

/** One `client_domains` row bound to its org, for deterministic primary selection. */
export interface OrgDomainEntry {
  readonly clientId: string;
  /** Lower-cased domain. */
  readonly domain: string;
  /** Org `created_at` (ISO) — the primary org is the earliest-created match. */
  readonly createdAt: string;
}

/** A meeting participant (attendee or organizer) for org resolution. */
export interface MeetingParticipant {
  readonly email: string | null;
  readonly name: string | null;
}

/** Everything the scan needs to persist about one meeting's org identity. */
export interface MeetingOrgResolution {
  /** Every participant is on an internal domain (no external org, no free-email). */
  readonly isInternal: boolean;
  /** External, non-free, non-internal attendee/organizer domains. */
  readonly externalOrgDomains: string[];
  /** Orgs matched by domain (any non-internal type present in `client_domains`). */
  readonly matchedClientIds: string[];
  /** External org domains with no `client_domains` entry (offer "create org"). */
  readonly unknownOrgDomains: string[];
  /** Every non-internal attendee/organizer with a domain (org + free-email). */
  readonly externalAttendees: ExternalAttendee[];
  /** Denormalized primary org: the earliest-created matched org, else null. */
  readonly primaryClientId: string | null;
}

/**
 * Resolve one meeting's org identity from its participants. `internalDomains` and
 * `domainToOrg` (domain → org, from `client_domains` filtered to non-internal
 * orgs) are loaded once per scan by the caller.
 */
export function resolveMeetingOrgs(
  input: {
    readonly attendees: readonly MeetingParticipant[];
    readonly organizerEmail: string | null;
  },
  ctx: {
    readonly internalDomains: ReadonlySet<string>;
    readonly domainToOrg: ReadonlyMap<string, OrgDomainEntry>;
  },
): MeetingOrgResolution {
  // Dedup participants by lower-cased email (organizer often re-appears as an attendee).
  const byEmail = new Map<string, MeetingParticipant>();
  const consider = (p: MeetingParticipant): void => {
    if (p.email === null) return;
    const email = p.email.trim().toLowerCase();
    if (email === '') return;
    const existing = byEmail.get(email);
    // Prefer the copy that carries a display name.
    if (existing === undefined || (existing.name === null && p.name !== null)) {
      byEmail.set(email, { email, name: p.name });
    }
  };
  for (const a of input.attendees) consider(a);
  consider({ email: input.organizerEmail, name: null });

  const externalOrgDomains = new Set<string>();
  const externalAttendees: ExternalAttendee[] = [];
  let internalCount = 0;
  let externalCount = 0;

  for (const p of byEmail.values()) {
    const domain = emailDomain(p.email);
    if (domain === null) continue;
    if (ctx.internalDomains.has(domain)) {
      internalCount += 1;
      continue;
    }
    externalCount += 1;
    externalAttendees.push({ email: p.email as string, name: p.name, domain });
    if (!isFreeEmailDomain(domain)) externalOrgDomains.add(domain);
  }

  // Internal only when there's at least one GA participant and NO external one.
  const isInternal = externalCount === 0 && internalCount > 0;

  const matched: OrgDomainEntry[] = [];
  const unknownOrgDomains: string[] = [];
  for (const domain of externalOrgDomains) {
    const org = ctx.domainToOrg.get(domain);
    if (org !== undefined) matched.push(org);
    else unknownOrgDomains.push(domain);
  }

  // Distinct matched org ids; primary = earliest-created (tie-break by id) so the
  // denormalized `client_id` is deterministic across re-scans.
  const matchedClientIds = [...new Set(matched.map((m) => m.clientId))];
  const primaryClientId =
    matched.length === 0
      ? null
      : [...matched].sort((a, b) => {
          const t = Date.parse(a.createdAt) - Date.parse(b.createdAt);
          return t !== 0 ? t : a.clientId.localeCompare(b.clientId);
        })[0]?.clientId ?? null;

  return {
    isInternal,
    externalOrgDomains: [...externalOrgDomains],
    matchedClientIds,
    unknownOrgDomains,
    externalAttendees,
    primaryClientId,
  };
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
