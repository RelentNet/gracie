/**
 * Server-side data access for Contacts & Org Charts (phase `CO`).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement is
 * the API layer's job (docs/02 §D14). Runs only on the server — never import into a
 * client component. Modeled on lib/data/clients.ts + lib/data/calendar.ts.
 *
 * Model invariants (docs/plan/contacts-org-charts.md §2):
 *  - A VACANT office has no `contact_affiliations` row with `office_id = it AND is_current`.
 *  - Filling an office / moving a person ENDS the prior current holder first (history is
 *    preserved: `ended_on = today`, `is_current = false`) — done here, not in the DB.
 *  - A contact may hold several current affiliations across DIFFERENT orgs; the partial
 *    unique index only constrains at most one current holder PER office.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database, ServerClient } from '@gracie/db';
import type {
  AffiliationView,
  Contact,
  ContactAffiliation,
  ContactSuggestionView,
  ContactWithAffiliations,
  Office,
  OfficeHolder,
  OfficeTreeNode,
  OfficeWithHolder,
  OrgChart,
} from '@gracie/shared';

import {
  mapAffiliation,
  mapContact,
  mapOffice,
  mapSuggestion,
  mapAffiliationView,
  type AffiliationRowWithJoins,
} from '../mappers/contacts.js';

type ContactInsert = Database['public']['Tables']['contacts']['Insert'];
type ContactUpdate = Database['public']['Tables']['contacts']['Update'];
type OfficeInsert = Database['public']['Tables']['offices']['Insert'];
type OfficeUpdate = Database['public']['Tables']['offices']['Update'];
type AffiliationInsert = Database['public']['Tables']['contact_affiliations']['Insert'];
type AffiliationUpdate = Database['public']['Tables']['contact_affiliations']['Update'];

/** Enriched-affiliation select: the row + org, office, and contact display fields. */
const AFFILIATION_SELECT = '*, clients(name, type), offices(title), contacts(full_name, email, phone)';

// --- small helpers ----------------------------------------------------------------

/** Today as an ISO date (YYYY-MM-DD) — the tenure end/start stamp. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Trim a nullable text field; empty/whitespace-only clears it to null. */
function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Sort affiliations for display: current first, then most-recently-started, then newest row. */
function sortAffiliations(list: AffiliationView[]): void {
  list.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const as = a.startedOn ?? '';
    const bs = b.startedOn ?? '';
    if (as !== bs) return as < bs ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

// --- Contacts ---------------------------------------------------------------------

export interface NewContactInput {
  readonly fullName: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly linkedinUrl?: string | null;
  readonly notes?: string | null;
  readonly createdByUserId?: string | null;
}

/** Insert a new contact (person). Affiliations are created separately. */
export async function createContact(input: NewContactInput): Promise<Contact> {
  const db = getServerClient();
  const fullName = input.fullName.trim();
  if (fullName === '') throw new Error('A contact name is required.');
  const insert: ContactInsert = {
    full_name: fullName,
    email: cleanText(input.email),
    phone: cleanText(input.phone),
    linkedin_url: cleanText(input.linkedinUrl),
    notes: cleanText(input.notes),
    created_by_user_id: input.createdByUserId ?? null,
  };
  const { data, error } = await db.from('contacts').insert(insert).select('*').single();
  if (error !== null) throw new Error(`createContact: ${error.message}`);
  return mapContact(data);
}

export interface ContactPatch {
  readonly fullName?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly linkedinUrl?: string | null;
  readonly notes?: string | null;
}

/** Update a contact's editable fields. Throws `'Unknown contact'` on a bad id. */
export async function updateContact(id: string, patch: ContactPatch): Promise<Contact> {
  const db = getServerClient();
  const update: ContactUpdate = { updated_at: new Date().toISOString() };
  if (patch.fullName !== undefined) {
    const name = patch.fullName.trim();
    if (name === '') throw new Error('A contact name is required.');
    update.full_name = name;
  }
  if (patch.email !== undefined) update.email = cleanText(patch.email);
  if (patch.phone !== undefined) update.phone = cleanText(patch.phone);
  if (patch.linkedinUrl !== undefined) update.linkedin_url = cleanText(patch.linkedinUrl);
  if (patch.notes !== undefined) update.notes = cleanText(patch.notes);

  const { data, error } = await db
    .from('contacts')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateContact: ${error.message}`);
  if (data === null) throw new Error('Unknown contact');
  return mapContact(data);
}

/** Delete a contact — cascades affiliations (its office holdings go vacant). */
export async function deleteContact(id: string): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('contacts').delete().eq('id', id);
  if (error !== null) throw new Error(`deleteContact: ${error.message}`);
}

/** Fetch enriched affiliations for a set of contacts, keyed by contact id. */
async function affiliationViewsByContact(
  db: ServerClient,
  contactIds: readonly string[],
  includePast: boolean,
): Promise<Map<string, AffiliationView[]>> {
  const map = new Map<string, AffiliationView[]>();
  if (contactIds.length === 0) return map;
  const base = db
    .from('contact_affiliations')
    .select(AFFILIATION_SELECT)
    .in('contact_id', [...contactIds]);
  const { data, error } = await (includePast ? base : base.eq('is_current', true));
  if (error !== null) throw new Error(`affiliationViewsByContact: ${error.message}`);
  for (const row of (data ?? []) as unknown as AffiliationRowWithJoins[]) {
    const view = mapAffiliationView(row);
    const list = map.get(view.contactId) ?? [];
    list.push(view);
    map.set(view.contactId, list);
  }
  for (const list of map.values()) sortAffiliations(list);
  return map;
}

export interface ListContactsFilter {
  /** Restrict to contacts affiliated with this org. */
  readonly clientId?: string;
  /** Case-insensitive substring match on name/email. */
  readonly search?: string;
  /** Include past (ended) affiliations + org-scope past members. Default false. */
  readonly includePast?: boolean;
}

/**
 * List contacts (each with their affiliations), ordered by name. Optionally scoped to
 * an org and/or filtered by a name/email substring. `includePast` controls whether
 * ended affiliations (and, when org-scoped, former members) are included.
 */
export async function listContacts(
  filter: ListContactsFilter = {},
): Promise<ContactWithAffiliations[]> {
  const db = getServerClient();
  const includePast = filter.includePast ?? false;

  // When scoped to an org, restrict to contacts affiliated with it.
  let allowedContactIds: Set<string> | null = null;
  if (filter.clientId !== undefined) {
    const scopeBase = db
      .from('contact_affiliations')
      .select('contact_id')
      .eq('client_id', filter.clientId);
    const { data, error } = await (includePast ? scopeBase : scopeBase.eq('is_current', true));
    if (error !== null) throw new Error(`listContacts(scope): ${error.message}`);
    allowedContactIds = new Set((data ?? []).map((r) => r.contact_id));
    if (allowedContactIds.size === 0) return [];
  }

  const { data: rows, error } = await db
    .from('contacts')
    .select('*')
    .order('full_name', { ascending: true });
  if (error !== null) throw new Error(`listContacts: ${error.message}`);

  let contacts = (rows ?? []).map(mapContact);
  if (allowedContactIds !== null) {
    const allowed = allowedContactIds;
    contacts = contacts.filter((c) => allowed.has(c.id));
  }
  const needle = (filter.search ?? '').trim().toLowerCase();
  if (needle !== '') {
    contacts = contacts.filter(
      (c) =>
        c.fullName.toLowerCase().includes(needle) ||
        (c.email ?? '').toLowerCase().includes(needle),
    );
  }

  const byContact = await affiliationViewsByContact(
    db,
    contacts.map((c) => c.id),
    includePast,
  );
  return contacts.map((c) => ({ ...c, affiliations: byContact.get(c.id) ?? [] }));
}

/** Fetch a single contact with its FULL affiliation history (current + past), or null. */
export async function getContact(id: string): Promise<ContactWithAffiliations | null> {
  const db = getServerClient();
  const { data, error } = await db.from('contacts').select('*').eq('id', id).maybeSingle();
  if (error !== null) throw new Error(`getContact: ${error.message}`);
  if (data === null) return null;
  const byContact = await affiliationViewsByContact(db, [id], true);
  return { ...mapContact(data), affiliations: byContact.get(id) ?? [] };
}

// --- Offices ----------------------------------------------------------------------

/** List an org's offices, ordered by sort_order then title. */
export async function listOffices(clientId: string): Promise<Office[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('offices')
    .select('*')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });
  if (error !== null) throw new Error(`listOffices: ${error.message}`);
  return (data ?? []).map(mapOffice);
}

/** Validate an office exists and belongs to `clientId` (used for parent + holder ops). */
async function requireOfficeInOrg(
  db: ServerClient,
  officeId: string,
  clientId: string,
): Promise<void> {
  const { data, error } = await db
    .from('offices')
    .select('id, client_id')
    .eq('id', officeId)
    .maybeSingle();
  if (error !== null) throw new Error(`requireOfficeInOrg: ${error.message}`);
  if (data === null) throw new Error('Unknown office');
  if (data.client_id !== clientId) throw new Error('Office belongs to a different organization.');
}

/** Reject a reports-to change that would create a cycle (walk parents up to a root). */
async function ensureNoCycle(
  db: ServerClient,
  clientId: string,
  officeId: string,
  newParentId: string,
): Promise<void> {
  const { data, error } = await db
    .from('offices')
    .select('id, parent_office_id')
    .eq('client_id', clientId);
  if (error !== null) throw new Error(`ensureNoCycle: ${error.message}`);
  const parentOf = new Map<string, string | null>();
  for (const o of data ?? []) parentOf.set(o.id, o.parent_office_id);
  const seen = new Set<string>();
  let cursor: string | null = newParentId;
  while (cursor !== null) {
    if (cursor === officeId) throw new Error('That would create a reporting cycle.');
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
}

export interface NewOfficeInput {
  readonly clientId: string;
  readonly title: string;
  readonly parentOfficeId?: string | null;
  readonly description?: string | null;
  readonly isKey?: boolean;
  readonly sortOrder?: number;
}

/** Create an office (an org-chart node). Validates the parent belongs to the same org. */
export async function createOffice(input: NewOfficeInput): Promise<Office> {
  const db = getServerClient();
  const title = input.title.trim();
  if (title === '') throw new Error('An office title is required.');
  if (input.parentOfficeId !== null && input.parentOfficeId !== undefined) {
    await requireOfficeInOrg(db, input.parentOfficeId, input.clientId);
  }
  const insert: OfficeInsert = {
    client_id: input.clientId,
    title,
    parent_office_id: input.parentOfficeId ?? null,
    description: cleanText(input.description),
    is_key: input.isKey ?? false,
    sort_order: input.sortOrder ?? 0,
  };
  const { data, error } = await db.from('offices').insert(insert).select('*').single();
  if (error !== null) throw new Error(`createOffice: ${error.message}`);
  return mapOffice(data);
}

export interface OfficePatch {
  readonly title?: string;
  readonly parentOfficeId?: string | null;
  readonly description?: string | null;
  readonly isKey?: boolean;
  readonly sortOrder?: number;
}

/** Update an office (title / reports-to / key flag / order). Guards self + cycles. */
export async function updateOffice(id: string, patch: OfficePatch): Promise<Office> {
  const db = getServerClient();
  const cur = await db.from('offices').select('id, client_id').eq('id', id).maybeSingle();
  if (cur.error !== null) throw new Error(`updateOffice: ${cur.error.message}`);
  if (cur.data === null) throw new Error('Unknown office');

  const update: OfficeUpdate = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t === '') throw new Error('An office title is required.');
    update.title = t;
  }
  if (patch.parentOfficeId !== undefined) {
    if (patch.parentOfficeId !== null) {
      if (patch.parentOfficeId === id) throw new Error('An office can’t report to itself.');
      await requireOfficeInOrg(db, patch.parentOfficeId, cur.data.client_id);
      await ensureNoCycle(db, cur.data.client_id, id, patch.parentOfficeId);
    }
    update.parent_office_id = patch.parentOfficeId;
  }
  if (patch.description !== undefined) update.description = cleanText(patch.description);
  if (patch.isKey !== undefined) update.is_key = patch.isKey;
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;

  const { data, error } = await db
    .from('offices')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateOffice: ${error.message}`);
  if (data === null) throw new Error('Unknown office');
  return mapOffice(data);
}

/**
 * Delete an office. Children's `parent_office_id` and any affiliations' `office_id`
 * are set null by the FKs (children reparent to root; holders become freeform roles).
 */
export async function deleteOffice(id: string): Promise<void> {
  const db = getServerClient();
  const { error } = await db.from('offices').delete().eq('id', id);
  if (error !== null) throw new Error(`deleteOffice: ${error.message}`);
}

/** Build the reports-to tree from a flat, holder-enriched office list (pure). */
export function buildOfficeTree(offices: readonly OfficeWithHolder[]): OfficeTreeNode[] {
  const nodes = new Map<string, OfficeTreeNode & { children: OfficeTreeNode[] }>();
  for (const o of offices) nodes.set(o.id, { ...o, children: [] });
  const roots: OfficeTreeNode[] = [];
  for (const o of offices) {
    const node = nodes.get(o.id);
    if (node === undefined) continue;
    const parent = o.parentOfficeId !== null ? nodes.get(o.parentOfficeId) : undefined;
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * The visual org chart for one org: offices enriched with their current holder, as a
 * reports-to tree (`roots`) plus a flat list (`offices`) for pickers / counts. A
 * VACANT office is one whose `holder` is null.
 */
export async function getOrgChart(clientId: string): Promise<OrgChart> {
  const db = getServerClient();
  const offices = await listOffices(clientId);

  const holders = new Map<string, OfficeHolder>();
  if (offices.length > 0) {
    const { data, error } = await db
      .from('contact_affiliations')
      .select('id, contact_id, office_id, started_on, contacts(full_name)')
      .eq('client_id', clientId)
      .eq('is_current', true)
      .not('office_id', 'is', null);
    if (error !== null) throw new Error(`getOrgChart(holders): ${error.message}`);
    for (const row of data ?? []) {
      if (row.office_id === null) continue;
      const contact = (row.contacts ?? null) as { full_name: string } | null;
      holders.set(row.office_id, {
        affiliationId: row.id,
        contactId: row.contact_id,
        contactName: contact?.full_name ?? '',
        startedOn: row.started_on,
      });
    }
  }

  const withHolder: OfficeWithHolder[] = offices.map((o) => ({
    ...o,
    holder: holders.get(o.id) ?? null,
  }));
  return { clientId, roots: buildOfficeTree(withHolder), offices: withHolder };
}

// --- Affiliations -----------------------------------------------------------------

/** End the current holder of an office (preserves the row as history). */
async function endOfficeCurrentHolder(db: ServerClient, officeId: string): Promise<void> {
  const { error } = await db
    .from('contact_affiliations')
    .update({ is_current: false, ended_on: todayIso(), updated_at: new Date().toISOString() })
    .eq('office_id', officeId)
    .eq('is_current', true);
  if (error !== null) throw new Error(`endOfficeCurrentHolder: ${error.message}`);
}

/** Vacate an office — end its current holder's affiliation (the row stays as history). */
export async function vacateOffice(officeId: string): Promise<void> {
  await endOfficeCurrentHolder(getServerClient(), officeId);
}

export interface NewAffiliationInput {
  readonly contactId: string;
  /** The org. Required unless `officeId` is given (then derived from the office). */
  readonly clientId?: string;
  readonly officeId?: string | null;
  readonly title?: string | null;
  readonly orgEmail?: string | null;
  readonly orgPhone?: string | null;
  readonly startedOn?: string | null;
  readonly notes?: string | null;
}

/**
 * Create a current affiliation (contact ↔ org, optional office). When an office is
 * given, its prior current holder is ENDED first so the single-current-holder
 * invariant holds and history is preserved.
 */
export async function createAffiliation(input: NewAffiliationInput): Promise<ContactAffiliation> {
  const db = getServerClient();
  let clientId = input.clientId ?? null;
  const officeId = input.officeId ?? null;

  if (officeId !== null) {
    const office = await db
      .from('offices')
      .select('id, client_id')
      .eq('id', officeId)
      .maybeSingle();
    if (office.error !== null) throw new Error(`createAffiliation: ${office.error.message}`);
    if (office.data === null) throw new Error('Unknown office');
    if (clientId === null) clientId = office.data.client_id;
    else if (clientId !== office.data.client_id) {
      throw new Error('Office belongs to a different organization.');
    }
  }
  if (clientId === null) throw new Error('An organization is required.');

  if (officeId !== null) await endOfficeCurrentHolder(db, officeId);

  const insert: AffiliationInsert = {
    contact_id: input.contactId,
    client_id: clientId,
    office_id: officeId,
    title: cleanText(input.title),
    org_email: cleanText(input.orgEmail),
    org_phone: cleanText(input.orgPhone),
    started_on: input.startedOn === '' ? null : (input.startedOn ?? null),
    notes: cleanText(input.notes),
    is_current: true,
  };
  const { data, error } = await db
    .from('contact_affiliations')
    .insert(insert)
    .select('*')
    .single();
  if (error !== null) {
    if (error.code === '23505') throw new Error('That office already has a current holder.');
    throw new Error(`createAffiliation: ${error.message}`);
  }
  return mapAffiliation(data);
}

/**
 * Set (or replace) an office's current holder — the "fill / move a person" action.
 * Encapsulates the end-prior-holder invariant via {@link createAffiliation}.
 */
export async function setOfficeHolder(
  officeId: string,
  contactId: string,
  opts: {
    readonly startedOn?: string | null;
    readonly title?: string | null;
    readonly orgEmail?: string | null;
    readonly orgPhone?: string | null;
    readonly notes?: string | null;
  } = {},
): Promise<ContactAffiliation> {
  return createAffiliation({
    contactId,
    officeId,
    startedOn: opts.startedOn ?? todayIso(),
    title: opts.title ?? null,
    orgEmail: opts.orgEmail ?? null,
    orgPhone: opts.orgPhone ?? null,
    notes: opts.notes ?? null,
  });
}

/** End an affiliation (person left / moved on). The row stays as history. */
export async function endAffiliation(id: string): Promise<ContactAffiliation> {
  const db = getServerClient();
  const { data, error } = await db
    .from('contact_affiliations')
    .update({ is_current: false, ended_on: todayIso(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`endAffiliation: ${error.message}`);
  if (data === null) throw new Error('Unknown affiliation');
  return mapAffiliation(data);
}

export interface AffiliationPatch {
  readonly title?: string | null;
  readonly orgEmail?: string | null;
  readonly orgPhone?: string | null;
  readonly startedOn?: string | null;
  readonly notes?: string | null;
}

/** Update an affiliation's metadata (moving orgs/offices uses end + create instead). */
export async function updateAffiliation(
  id: string,
  patch: AffiliationPatch,
): Promise<ContactAffiliation> {
  const db = getServerClient();
  const update: AffiliationUpdate = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) update.title = cleanText(patch.title);
  if (patch.orgEmail !== undefined) update.org_email = cleanText(patch.orgEmail);
  if (patch.orgPhone !== undefined) update.org_phone = cleanText(patch.orgPhone);
  if (patch.startedOn !== undefined) update.started_on = patch.startedOn === '' ? null : patch.startedOn;
  if (patch.notes !== undefined) update.notes = cleanText(patch.notes);

  const { data, error } = await db
    .from('contact_affiliations')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error !== null) throw new Error(`updateAffiliation: ${error.message}`);
  if (data === null) throw new Error('Unknown affiliation');
  return mapAffiliation(data);
}

/** List a contact's affiliations (current + past), enriched + sorted. */
export async function listAffiliationsForContact(contactId: string): Promise<AffiliationView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('contact_affiliations')
    .select(AFFILIATION_SELECT)
    .eq('contact_id', contactId);
  if (error !== null) throw new Error(`listAffiliationsForContact: ${error.message}`);
  const views = ((data ?? []) as unknown as AffiliationRowWithJoins[]).map(mapAffiliationView);
  sortAffiliations(views);
  return views;
}

/** List an org's affiliations (current only unless `includePast`), enriched + sorted. */
export async function listAffiliationsForOrg(
  clientId: string,
  includePast = false,
): Promise<AffiliationView[]> {
  const db = getServerClient();
  const base = db.from('contact_affiliations').select(AFFILIATION_SELECT).eq('client_id', clientId);
  const { data, error } = await (includePast ? base : base.eq('is_current', true));
  if (error !== null) throw new Error(`listAffiliationsForOrg: ${error.message}`);
  const views = ((data ?? []) as unknown as AffiliationRowWithJoins[]).map(mapAffiliationView);
  sortAffiliations(views);
  return views;
}

// --- Suggestions ------------------------------------------------------------------

/** List pending suggestions, newest first, enriched with the guessed org + meeting title. */
export async function listPendingSuggestions(): Promise<ContactSuggestionView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('contact_suggestions')
    .select('*, clients(name), meetings(title)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error !== null) throw new Error(`listPendingSuggestions: ${error.message}`);
  return (data ?? []).map((row) => {
    const org = (row.clients ?? null) as { name: string } | null;
    const meeting = (row.meetings ?? null) as { title: string | null } | null;
    return {
      ...mapSuggestion(row as unknown as Database['public']['Tables']['contact_suggestions']['Row']),
      orgName: org?.name ?? null,
      meetingTitle: meeting?.title ?? null,
    };
  });
}

export interface AcceptSuggestionInput {
  readonly resolvedByUserId: string | null;
  /** Override the guessed org (else the suggestion's `client_id`). null = don't affiliate. */
  readonly clientId?: string | null;
  readonly officeId?: string | null;
  readonly title?: string | null;
}

/**
 * Accept a suggestion: reuse an existing contact with the same email or create one,
 * optionally affiliate to the guessed/overridden org (+ office), and mark the
 * suggestion `accepted`. Returns the resulting contact.
 */
export async function acceptSuggestion(
  id: string,
  input: AcceptSuggestionInput,
): Promise<{ contact: Contact }> {
  const db = getServerClient();
  const sugRes = await db.from('contact_suggestions').select('*').eq('id', id).maybeSingle();
  if (sugRes.error !== null) throw new Error(`acceptSuggestion: ${sugRes.error.message}`);
  if (sugRes.data === null) throw new Error('Unknown suggestion');
  const sug = sugRes.data;
  if (sug.status !== 'pending') throw new Error('That suggestion has already been resolved.');

  // Reuse an existing contact with the same email, else create a new one.
  let contact: Contact | null = null;
  const email = sug.suggested_email !== null ? sug.suggested_email.trim() : '';
  if (email !== '') {
    const existing = await db.from('contacts').select('*').ilike('email', email).limit(1).maybeSingle();
    if (existing.error !== null) throw new Error(`acceptSuggestion(find): ${existing.error.message}`);
    if (existing.data !== null) contact = mapContact(existing.data);
  }
  if (contact === null) {
    const fallbackName =
      (sug.suggested_name ?? '').trim() !== ''
        ? (sug.suggested_name as string)
        : email !== ''
          ? email
          : 'Unnamed contact';
    contact = await createContact({
      fullName: fallbackName,
      email: sug.suggested_email,
      createdByUserId: input.resolvedByUserId,
    });
  }

  // Optionally affiliate to the guessed / overridden org.
  const clientId = input.clientId !== undefined ? input.clientId : sug.client_id;
  const officeId =
    input.officeId !== undefined
      ? input.officeId
      : clientId === sug.client_id
        ? sug.office_id
        : null;
  if (clientId !== null && clientId !== undefined) {
    await createAffiliation({
      contactId: contact.id,
      clientId,
      officeId,
      title: input.title ?? null,
      startedOn: todayIso(),
    });
  }

  const upd = await db
    .from('contact_suggestions')
    .update({
      status: 'accepted',
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: input.resolvedByUserId,
    })
    .eq('id', id);
  if (upd.error !== null) throw new Error(`acceptSuggestion(resolve): ${upd.error.message}`);
  return { contact };
}

/** Dismiss a pending suggestion — it won't resurface (the generator skips dismissed). */
export async function dismissSuggestion(
  id: string,
  resolvedByUserId: string | null,
): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('contact_suggestions')
    .update({
      status: 'dismissed',
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: resolvedByUserId,
    })
    .eq('id', id)
    .eq('status', 'pending');
  if (error !== null) throw new Error(`dismissSuggestion: ${error.message}`);
}

// --- Export (CSV / vCard) — pure string builders ----------------------------------

/** Quote a CSV cell when it contains a comma, quote, or newline (RFC 4180). */
function csvCell(value: string | null): string {
  const s = value ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: readonly (string | null)[]): string {
  return cells.map(csvCell).join(',');
}

const CONTACT_CSV_HEADER = [
  'Full name',
  'Email',
  'Phone',
  'LinkedIn',
  'Notes',
  'Organization',
  'Org type',
  'Office / title',
  'Org email',
  'Org phone',
  'Started',
  'Ended',
  'Current',
] as const;

/** One contact + a row per affiliation as CSV (mobile-friendly download). */
export function contactToCsv(contact: ContactWithAffiliations): string {
  const lines: string[] = [csvRow([...CONTACT_CSV_HEADER])];
  const base = [contact.fullName, contact.email, contact.phone, contact.linkedinUrl, contact.notes];
  if (contact.affiliations.length === 0) {
    lines.push(csvRow([...base, '', '', '', '', '', '', '', '']));
  } else {
    for (const a of contact.affiliations) {
      lines.push(
        csvRow([
          ...base,
          a.orgName,
          a.orgType,
          a.officeTitle ?? a.title,
          a.orgEmail,
          a.orgPhone,
          a.startedOn,
          a.endedOn,
          a.isCurrent ? 'Yes' : 'No',
        ]),
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

const ORG_CSV_HEADER = [
  'Contact',
  'Email',
  'Phone',
  'Organization',
  'Office / title',
  'Org email',
  'Org phone',
  'Started',
  'Ended',
  'Current',
] as const;

/** An org's affiliations as CSV (org-wide contact export). */
export function orgAffiliationsToCsv(affiliations: readonly AffiliationView[]): string {
  const lines: string[] = [csvRow([...ORG_CSV_HEADER])];
  for (const a of affiliations) {
    lines.push(
      csvRow([
        a.contactName,
        a.contactEmail,
        a.contactPhone,
        a.orgName,
        a.officeTitle ?? a.title,
        a.orgEmail,
        a.orgPhone,
        a.startedOn,
        a.endedOn,
        a.isCurrent ? 'Yes' : 'No',
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Escape a vCard text value (backslash, newline, comma, semicolon). */
function vcardEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * A vCard 3.0 for one contact — imports straight into a phone's address book. ORG/
 * TITLE use the first current affiliation; additional current orgs go into NOTE.
 */
export function contactToVCard(contact: ContactWithAffiliations): string {
  const current = contact.affiliations.filter((a) => a.isCurrent);
  const primary = current[0] ?? null;
  const parts = contact.fullName.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';

  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardEscape(contact.fullName)}`,
    `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
  ];
  if (contact.email !== null) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(contact.email)}`);
  if (contact.phone !== null) lines.push(`TEL;TYPE=CELL:${vcardEscape(contact.phone)}`);
  if (contact.linkedinUrl !== null) lines.push(`URL:${vcardEscape(contact.linkedinUrl)}`);
  if (primary !== null) {
    lines.push(`ORG:${vcardEscape(primary.orgName)}`);
    const roleTitle = primary.officeTitle ?? primary.title;
    if (roleTitle !== null && roleTitle !== '') lines.push(`TITLE:${vcardEscape(roleTitle)}`);
  }
  const noteBits: string[] = [];
  if (contact.notes !== null && contact.notes.trim() !== '') noteBits.push(contact.notes.trim());
  if (current.length > 1) {
    const others = current
      .slice(1)
      .map((a) => {
        const role = a.officeTitle ?? a.title;
        return role !== null && role !== '' ? `${a.orgName} (${role})` : a.orgName;
      })
      .join('; ');
    noteBits.push(`Also: ${others}`);
  }
  if (noteBits.length > 0) lines.push(`NOTE:${vcardEscape(noteBits.join(' — '))}`);
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}
