/**
 * Server-side data access for clients (Phase 1B).
 *
 * Uses the service-role Supabase client (bypasses RLS); permission enforcement
 * is the API layer's job (docs/02 §D14). Runs only on the server — never import
 * this into a client component.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';
import { isFreeEmailDomain } from '@gracie/shared';
import type { Client, ClientCadence, ClientDomain, ClientType, FeeTier } from '@gracie/shared';

import { backfillOrgDomains, loadInternalDomains } from './calendar.js';
import { mapClient, mapClientDomain } from '../mappers.js';

/**
 * List clients of the given party type(s), ordered by relationship health (desc).
 * Defaults to real `client`s only (P4.1) so leads/prospects/partners and the GA
 * internal org never leak into the client roster, cadence, or assign pickers.
 * Pass an explicit list (e.g. `['lead','prospect']`, `['internal']`) for the
 * dedicated lead/prospect tabs or the internal-workspace link.
 */
export async function listClients(
  types: readonly ClientType[] = ['client'],
): Promise<Client[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('clients')
    .select('*')
    .in('type', [...types])
    .order('relationship_health', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`listClients: ${error.message}`);
  return (data ?? []).map(mapClient);
}

/** Fetch a single client by id, or null if not found. */
export async function getClient(id: string): Promise<Client | null> {
  const db = getServerClient();
  const { data, error } = await db.from('clients').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  return data === null ? null : mapClient(data);
}

/**
 * Strip admin-only fields from a client for non-admin roles (docs/02 §D14).
 * Fee tier and contract value are omitted entirely, not nulled-and-hidden.
 */
export function redactClientForRole(client: Client, isAdmin: boolean): Client {
  if (isAdmin) return client;
  return { ...client, feeTier: null, contractValue: null };
}

export interface NewClientInput {
  readonly name: string;
  readonly type?: ClientType;
  readonly initials?: string;
  readonly cadence?: ClientCadence;
  readonly description?: string | null;
  readonly primaryContact?: string | null;
  readonly primaryContactEmail?: string | null;
  readonly contractNumber?: string | null;
  readonly billingCadence?: string | null;
  readonly feeTier?: FeeTier | null;
  readonly contractValue?: number | null;
  /** Optional org domains (P4.1) — inserted into `client_domains` (lower-cased). */
  readonly domains?: readonly string[];
}

/** Two-letter initials from a client name (fallback for an unspecified value). */
function deriveClientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  const initials = (first + second).toUpperCase();
  if (initials !== '') return initials;
  const fallback = name.trim().slice(0, 2).toUpperCase();
  return fallback !== '' ? fallback : '?';
}

/** Normalize a raw domain string to a lower-cased, bare host (no scheme/@/path). */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^.*@/, '')
    .replace(/\/.*$/, '')
    .trim();
}

/**
 * Insert a new client/party (Admin-only at the API layer, docs/05). Optionally
 * registers `client_domains` (P4.1) so future meetings on those domains match.
 * Returns the row. A duplicate domain surfaces as a clear error.
 */
export async function createClient(input: NewClientInput): Promise<Client> {
  const db = getServerClient();
  const initials =
    input.initials !== undefined && input.initials.trim() !== ''
      ? input.initials.trim()
      : deriveClientInitials(input.name);

  const insert: Database['public']['Tables']['clients']['Insert'] = {
    name: input.name,
    type: input.type ?? 'client',
    initials,
    cadence: input.cadence ?? 'monthly',
    description: input.description ?? null,
    primary_contact: input.primaryContact ?? null,
    primary_contact_email: input.primaryContactEmail ?? null,
    contract_number: input.contractNumber ?? null,
    billing_cadence: input.billingCadence ?? null,
    fee_tier: input.feeTier ?? null,
    contract_value: input.contractValue ?? null,
  };

  const { data, error } = await db.from('clients').insert(insert).select('*').single();
  if (error) throw new Error(`createClient: ${error.message}`);

  const domains = [...new Set((input.domains ?? []).map(normalizeDomain).filter((d) => d !== ''))];
  if (domains.length > 0) {
    const rows = domains.map((domain) => ({ client_id: data.id, domain }));
    const linked = await db.from('client_domains').insert(rows);
    if (linked.error !== null) {
      // The org row is already inserted; a unique-domain collision is the likely
      // cause. Surface it so the caller can report "domain already in use".
      if (linked.error.code === '23505') {
        throw new Error('One of those domains already belongs to another organization.');
      }
      throw new Error(`createClient(domains): ${linked.error.message}`);
    }
  }

  return mapClient(data);
}

/**
 * List an org's registered domains (P4.1), oldest-registered first. These are the
 * `client_domains` rows that match incoming meetings to this org by attendee
 * email domain.
 */
export async function listClientDomains(clientId: string): Promise<ClientDomain[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('client_domains')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error !== null) throw new Error(`listClientDomains: ${error.message}`);
  return (data ?? []).map(mapClientDomain);
}

/**
 * Register a new domain on an EXISTING org (P4.1) and backfill history: every
 * non-internal meeting carrying that domain links to the org, taking it as the
 * primary where still unassigned (via {@link backfillOrgDomains}). This is what
 * lets a multi-domain client (e.g. IBM = `ibm.com` + `us.ibm.com`) pick up the
 * meetings it was missing. Rejects free-email, internal, and already-taken
 * domains; a domain THIS org already owns is an idempotent no-op (still
 * backfills). Returns the org's full domain list after the change.
 */
export async function addClientDomain(clientId: string, domainRaw: string): Promise<ClientDomain[]> {
  const db = getServerClient();
  const domain = normalizeDomain(domainRaw);
  if (domain === '') throw new Error('A domain is required.');
  if (isFreeEmailDomain(domain)) {
    throw new Error('Free-email domains can’t identify an organization.');
  }
  const internalDomains = await loadInternalDomains(db);
  if (internalDomains.has(domain)) throw new Error('That is an internal domain.');

  // The org must exist (clear "Unknown client" 404 vs a bare FK violation), and
  // the reserved GA workspace is matched by internal domains, not client_domains.
  const clientRes = await db.from('clients').select('id, type').eq('id', clientId).maybeSingle();
  if (clientRes.error !== null) throw new Error(`addClientDomain: ${clientRes.error.message}`);
  if (clientRes.data === null) throw new Error('Unknown client');
  if (clientRes.data.type === 'internal') {
    throw new Error('The internal workspace is matched by internal domains, not client domains.');
  }

  // Ownership check against the global unique(lower(domain)) constraint:
  // idempotent for THIS org, a clear error when another org already owns it.
  const owner = await db
    .from('client_domains')
    .select('client_id')
    .eq('domain', domain)
    .maybeSingle();
  if (owner.error !== null) throw new Error(`addClientDomain: ${owner.error.message}`);
  if (owner.data !== null && owner.data.client_id !== clientId) {
    throw new Error('That domain already belongs to another organization.');
  }

  if (owner.data === null) {
    const ins = await db.from('client_domains').insert({ client_id: clientId, domain });
    if (ins.error !== null) {
      // A concurrent insert may have raced us onto the unique index.
      if (ins.error.code === '23505') {
        throw new Error('That domain already belongs to another organization.');
      }
      throw new Error(`addClientDomain: ${ins.error.message}`);
    }
  }

  // Retroactively link + set-primary existing meetings on the domain (idempotent).
  await backfillOrgDomains(clientId, [domain]);

  return listClientDomains(clientId);
}

/**
 * Remove a domain from an org (P4.1). Only stops FUTURE matching — existing
 * meeting↔org links are add-only/sticky and are LEFT in place, so history and any
 * denormalized primary stay intact. Returns the org's remaining domain list.
 */
export async function removeClientDomain(
  clientId: string,
  domainRaw: string,
): Promise<ClientDomain[]> {
  const db = getServerClient();
  const domain = normalizeDomain(domainRaw);
  if (domain === '') throw new Error('A domain is required.');
  const del = await db
    .from('client_domains')
    .delete()
    .eq('client_id', clientId)
    .eq('domain', domain);
  if (del.error !== null) throw new Error(`removeClientDomain: ${del.error.message}`);
  return listClientDomains(clientId);
}
