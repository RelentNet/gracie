/**
 * Contact-suggestions sweep processor (phase `CO`, docs/plan/contacts-org-charts.md §3).
 *
 * Scans `meetings.external_attendees` (the P4.1-captured non-GA attendees) and, for each
 * external email that is NOT already a `contacts.email` and NOT already a pending-or-
 * dismissed `contact_suggestions` row, upserts a pending suggestion — guessing the org by
 * domain (via `client_domains`) and recording the provenance meeting. Free-email and
 * internal domains are skipped. The Contacts UI shows these pending suggestions;
 * Accept/Dismiss resolves them.
 *
 * Source-agnostic by design: a future n8n web-scan inserts rows with `source='n8n_web'`
 * into the SAME queue/inbox. Idempotent — a pre-filter on existing contacts/suggestions
 * plus the `uq_suggestion_dedup` partial unique index prevent duplicates.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Json, ServerClient } from '@gracie/db';
import {
  emailDomain,
  isFreeEmailDomain,
  parseInternalDomains,
  type ContactSuggestionsJobPayload,
  type ExternalAttendee,
} from '@gracie/shared';

const INTERNAL_DOMAINS_SETTING_KEY = 'internal_email_domains';

/** Outcome of one sweep (visible in Bull Board). */
export interface ContactSuggestionsResult {
  readonly created: number;
  readonly scanned: number;
}

/** Defensively parse a stored `external_attendees` jsonb value into typed rows. */
function parseStoredExternalAttendees(value: Json | null): ExternalAttendee[] {
  if (!Array.isArray(value)) return [];
  const out: ExternalAttendee[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const email = typeof rec.email === 'string' ? rec.email : null;
    const domain = typeof rec.domain === 'string' ? rec.domain : null;
    if (email === null || domain === null) continue;
    out.push({ email, name: typeof rec.name === 'string' ? rec.name : null, domain });
  }
  return out;
}

/** The internal (GA) email domains from settings (default `graceandassociates.com`). */
async function loadInternalDomains(db: ServerClient): Promise<Set<string>> {
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('key', INTERNAL_DOMAINS_SETTING_KEY)
    .maybeSingle();
  if (error !== null) throw new Error(`contact-suggestions: load internal domains: ${error.message}`);
  return parseInternalDomains(typeof data?.value === 'string' ? data.value : null);
}

/** domain → org id (lower-cased), excluding the reserved internal org. */
async function loadDomainToOrg(db: ServerClient): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('client_domains')
    .select('domain, client_id, clients!inner(type)');
  if (error !== null) throw new Error(`contact-suggestions: load client_domains: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const org = row.clients as unknown as { type: string } | null;
    if (org === null || org.type === 'internal') continue;
    map.set(row.domain.trim().toLowerCase(), row.client_id);
  }
  return map;
}

/** Lower-cased set of emails already captured as a contact. */
async function loadExistingContactEmails(db: ServerClient): Promise<Set<string>> {
  const { data, error } = await db.from('contacts').select('email').not('email', 'is', null);
  if (error !== null) throw new Error(`contact-suggestions: load contacts: ${error.message}`);
  const set = new Set<string>();
  for (const r of data ?? []) if (r.email !== null) set.add(r.email.trim().toLowerCase());
  return set;
}

/**
 * Emails that already have a PENDING or DISMISSED calendar-attendee suggestion — never
 * re-suggest these (dismissed must not resurface; pending is already in the inbox).
 */
async function loadSuppressedEmails(db: ServerClient): Promise<Set<string>> {
  const { data, error } = await db
    .from('contact_suggestions')
    .select('suggested_email')
    .eq('source', 'calendar_attendee')
    .in('status', ['pending', 'dismissed'])
    .not('suggested_email', 'is', null);
  if (error !== null) throw new Error(`contact-suggestions: load suggestions: ${error.message}`);
  const set = new Set<string>();
  for (const r of data ?? []) if (r.suggested_email !== null) set.add(r.suggested_email.trim().toLowerCase());
  return set;
}

/** One new-contact candidate, deduped by lower-cased email. */
interface Candidate {
  readonly name: string | null;
  readonly email: string;
  readonly domain: string;
  readonly clientId: string | null;
  readonly meetingId: string;
}

/**
 * Build the contact-suggestions processor. Reads everything from the DB, is idempotent,
 * and logs its outcome (visible in Bull Board).
 */
export function createContactSuggestionsProcessor(
  logger: FastifyBaseLogger,
): Processor<ContactSuggestionsJobPayload, ContactSuggestionsResult> {
  return async (job: Job<ContactSuggestionsJobPayload>): Promise<ContactSuggestionsResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });

    const [internalDomains, domainToOrg, existingEmails, suppressed] = await Promise.all([
      loadInternalDomains(db),
      loadDomainToOrg(db),
      loadExistingContactEmails(db),
      loadSuppressedEmails(db),
    ]);

    // Light columns only; iterate newest meeting first so the first sighting of an email
    // is the most-recent meeting (used as provenance).
    const { data: meetings, error } = await db
      .from('meetings')
      .select('id, external_attendees, date_time')
      .order('date_time', { ascending: false });
    if (error !== null) throw new Error(`contact-suggestions: load meetings: ${error.message}`);

    const candidates = new Map<string, Candidate>();
    let scanned = 0;
    for (const m of meetings ?? []) {
      for (const a of parseStoredExternalAttendees(m.external_attendees)) {
        scanned += 1;
        const email = a.email.trim().toLowerCase();
        if (email === '') continue;
        const domain = (a.domain !== '' ? a.domain : (emailDomain(a.email) ?? '')).trim().toLowerCase();
        if (domain === '' || isFreeEmailDomain(domain) || internalDomains.has(domain)) continue;
        if (existingEmails.has(email) || suppressed.has(email)) continue;

        const existing = candidates.get(email);
        if (existing === undefined) {
          candidates.set(email, {
            name: a.name,
            email: a.email.trim(),
            domain,
            clientId: domainToOrg.get(domain) ?? null,
            meetingId: m.id,
          });
        } else if (existing.name === null && a.name !== null) {
          // Keep the most-recent meeting/org but backfill a display name if we now have one.
          candidates.set(email, { ...existing, name: a.name });
        }
      }
    }

    let created = 0;
    for (const c of candidates.values()) {
      const ins = await db.from('contact_suggestions').insert({
        source: 'calendar_attendee',
        suggested_name: c.name,
        suggested_email: c.email,
        suggested_domain: c.domain,
        client_id: c.clientId,
        meeting_id: c.meetingId,
      });
      if (ins.error !== null) {
        // 23505 = raced onto the pending partial unique index; treat as already-present.
        if (ins.error.code === '23505') continue;
        log.error({ email: c.email, err: ins.error }, 'contact-suggestions: insert failed');
        continue;
      }
      created += 1;
    }

    log.info(
      {
        created,
        candidates: candidates.size,
        scanned,
        meetings: (meetings ?? []).length,
        source: job.data.source,
      },
      'contact-suggestions sweep',
    );
    return { created, scanned };
  };
}
