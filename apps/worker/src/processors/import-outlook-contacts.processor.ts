/**
 * Import-Outlook-contacts processor — admin-triggered pull of ONE mailbox's Outlook
 * contacts into Gracie's `contacts` (MS Graph, app-only, mailbox-scoped by the same
 * Application Access Policy the calendar scan uses).
 *
 * Per contact (best-effort — one bad record never fails the batch):
 *   - map Graph fields → Gracie fields (see lib/outlook-contacts.ts),
 *   - UPSERT deduped by lower-cased email (fill-not-overwrite; no email → skip),
 *   - tag `contacts.source = outlook:<mailbox>` so imports are bulk-manageable later,
 *   - LIGHT org affiliation: if the contact's email domain OR companyName matches an
 *     EXISTING org, add a current `contact_affiliations` row (never auto-create orgs —
 *     that would spawn hundreds of junk orgs; the company stays a plain label).
 *
 * Idempotent + re-runnable. A 403/404 from Graph is caught and returned as a
 * `permission_denied` / `mailbox_not_found` result (NOT thrown) so the web surfaces
 * a precise message and the job doesn't burn retries. ⚠️ The daemon app needs the
 * `Contacts.Read` APPLICATION permission + admin consent (calendar only grants
 * `Calendars.Read`) — until then every mailbox 403s.
 */
import type { Job, Processor } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';

import { getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import {
  emailDomain,
  type OutlookContactsImportJobPayload,
} from '@gracie/shared';

import { createGraphClient, getGraphConfig } from '../lib/graph.js';
import {
  decideContactUpsert,
  mapGraphContact,
  type ExistingContact,
} from '../lib/outlook-contacts.js';

type ContactInsert = Database['public']['Tables']['contacts']['Insert'];
type AffiliationInsert = Database['public']['Tables']['contact_affiliations']['Insert'];

/** Why an import could not run/read (maps to a plain-language message in the web). */
type FailReason =
  | 'no_mailbox'
  | 'graph_not_configured'
  | 'permission_denied'
  | 'mailbox_not_found'
  | 'read_failed';

/** Outcome of one import (the BullMQ return value the web polls). */
export type ImportOutlookContactsResult =
  | {
      readonly ok: true;
      readonly mailbox: string;
      /** Raw Graph contacts seen. */
      readonly scanned: number;
      readonly imported: number;
      readonly updated: number;
      /** No email, or already present with nothing to fill. */
      readonly skipped: number;
      /** Contacts linked to an existing org (by domain/company). */
      readonly affiliated: number;
      /** Contacts that threw mid-record (logged, batch continued). */
      readonly errors: number;
    }
  | { readonly ok: false; readonly mailbox: string; readonly reason: FailReason };

/** Today as an ISO date (YYYY-MM-DD) — the affiliation tenure start stamp. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lower-cased-email → existing contact row (only rows that have an email). */
async function loadContactsByEmail(db: ServerClient): Promise<Map<string, ExistingContact>> {
  const { data, error } = await db
    .from('contacts')
    .select('id, full_name, email, phone, title, company, source')
    .not('email', 'is', null);
  if (error !== null) throw new Error(`import-outlook-contacts: load contacts: ${error.message}`);
  const map = new Map<string, ExistingContact>();
  for (const r of data ?? []) {
    if (r.email === null) continue;
    map.set(r.email.trim().toLowerCase(), {
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      title: r.title,
      company: r.company,
      source: r.source,
    });
  }
  return map;
}

/** domain (lower-cased) → org id, for real (non-internal) orgs only. */
async function loadDomainToOrg(db: ServerClient): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('client_domains')
    .select('domain, client_id, clients!inner(type)');
  if (error !== null) throw new Error(`import-outlook-contacts: load client_domains: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const org = row.clients as unknown as { type: string } | null;
    if (org === null || org.type === 'internal') continue;
    map.set(row.domain.trim().toLowerCase(), row.client_id);
  }
  return map;
}

/** org name (lower-cased) → org id (first wins on duplicate names). */
async function loadNameToOrg(db: ServerClient): Promise<Map<string, string>> {
  const { data, error } = await db.from('clients').select('id, name');
  if (error !== null) throw new Error(`import-outlook-contacts: load clients: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const key = row.name.trim().toLowerCase();
    if (key !== '' && !map.has(key)) map.set(key, row.id);
  }
  return map;
}

/**
 * Ensure a current affiliation exists between a contact and an org (add-only,
 * idempotent). A no-op if one is already current. Returns true when it created one.
 */
async function ensureAffiliation(
  db: ServerClient,
  contactId: string,
  clientId: string,
  title: string | null,
): Promise<boolean> {
  const existing = await db
    .from('contact_affiliations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('client_id', clientId)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle();
  if (existing.error !== null) {
    throw new Error(`import-outlook-contacts: affiliation lookup: ${existing.error.message}`);
  }
  if (existing.data !== null) return false;

  const insert: AffiliationInsert = {
    contact_id: contactId,
    client_id: clientId,
    title,
    is_current: true,
    started_on: todayIso(),
  };
  const { error } = await db.from('contact_affiliations').insert(insert);
  // 23505 = raced onto the office-holder unique index (office_id null here so
  // unlikely) — treat as already-present.
  if (error !== null && error.code !== '23505') {
    throw new Error(`import-outlook-contacts: affiliation insert: ${error.message}`);
  }
  return error === null;
}

/** Build the import-Outlook-contacts processor, logging through the worker logger. */
export function createImportOutlookContactsProcessor(
  logger: FastifyBaseLogger,
): Processor<OutlookContactsImportJobPayload, ImportOutlookContactsResult> {
  return async (job: Job<OutlookContactsImportJobPayload>): Promise<ImportOutlookContactsResult> => {
    const db = getServerClient();
    const log = logger.child({ jobId: job.id });
    const mailbox = job.data.mailbox.trim().toLowerCase();
    if (mailbox === '') return { ok: false, mailbox, reason: 'no_mailbox' };

    const config = getGraphConfig();
    if (config === null) {
      log.warn('import-outlook-contacts: MS Graph not configured (MS_* env)');
      return { ok: false, mailbox, reason: 'graph_not_configured' };
    }

    const graph = createGraphClient(config, log);
    const read = await graph.listMailboxContacts(mailbox);
    if (!read.ok) {
      const reason: FailReason = read.status === 403 ? 'permission_denied' : read.status === 404 ? 'mailbox_not_found' : 'read_failed';
      log.warn({ mailbox, status: read.status, reason }, 'import-outlook-contacts: read denied');
      return { ok: false, mailbox, reason };
    }

    const [byEmail, domainToOrg, nameToOrg] = await Promise.all([
      loadContactsByEmail(db),
      loadDomainToOrg(db),
      loadNameToOrg(db),
    ]);
    const source = `outlook:${mailbox}`;

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let affiliated = 0;
    let errors = 0;

    for (const raw of read.contacts) {
      try {
        const mapped = mapGraphContact(raw);
        if (mapped === null) {
          skipped += 1; // no usable email — can't dedupe
          continue;
        }
        const key = mapped.email.toLowerCase();
        const decision = decideContactUpsert(byEmail.get(key) ?? null, mapped, source);

        let contactId: string;
        if (decision.action === 'insert') {
          const insert: ContactInsert = decision.row;
          const { data, error } = await db.from('contacts').insert(insert).select('id').single();
          if (error !== null) throw new Error(error.message);
          contactId = data.id;
          imported += 1;
          // Remember it so a duplicate email later in the batch dedupes.
          byEmail.set(key, {
            id: contactId,
            full_name: mapped.name,
            phone: mapped.phone,
            title: mapped.title,
            company: mapped.company,
            source,
          });
        } else if (decision.action === 'update') {
          const { error } = await db.from('contacts').update(decision.patch).eq('id', decision.id);
          if (error !== null) throw new Error(error.message);
          contactId = decision.id;
          updated += 1;
        } else {
          contactId = decision.id;
          skipped += 1;
        }

        // Light org affiliation: match an EXISTING org by email domain, else by
        // companyName. Never auto-create an org. Add-only + idempotent.
        const domain = (emailDomain(mapped.email) ?? '').toLowerCase();
        const orgId =
          (domain !== '' ? domainToOrg.get(domain) : undefined) ??
          (mapped.company !== null ? nameToOrg.get(mapped.company.toLowerCase()) : undefined) ??
          null;
        if (orgId !== null) {
          const created = await ensureAffiliation(db, contactId, orgId, mapped.title);
          if (created) affiliated += 1;
        }
      } catch (error) {
        errors += 1;
        log.error(
          { err: error instanceof Error ? error.message : String(error) },
          'import-outlook-contacts: contact failed — skipping',
        );
      }
    }

    const result: ImportOutlookContactsResult = {
      ok: true,
      mailbox,
      scanned: read.contacts.length,
      imported,
      updated,
      skipped,
      affiliated,
      errors,
    };
    log.info(result, 'import-outlook-contacts complete');
    return result;
  };
}
