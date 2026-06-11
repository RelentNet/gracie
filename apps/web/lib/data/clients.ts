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
import type { Client, ClientCadence, FeeTier } from '@gracie/shared';

import { mapClient } from '../mappers.js';

/** List all clients, ordered by relationship health (desc). */
export async function listClients(): Promise<Client[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('clients')
    .select('*')
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
  readonly initials?: string;
  readonly cadence?: ClientCadence;
  readonly description?: string | null;
  readonly primaryContact?: string | null;
  readonly primaryContactEmail?: string | null;
  readonly contractNumber?: string | null;
  readonly billingCadence?: string | null;
  readonly feeTier?: FeeTier | null;
  readonly contractValue?: number | null;
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

/** Insert a new client (Admin-only at the API layer, docs/05). Returns the row. */
export async function createClient(input: NewClientInput): Promise<Client> {
  const db = getServerClient();
  const initials =
    input.initials !== undefined && input.initials.trim() !== ''
      ? input.initials.trim()
      : deriveClientInitials(input.name);

  const insert: Database['public']['Tables']['clients']['Insert'] = {
    name: input.name,
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
  return mapClient(data);
}
