/**
 * GET  /api/clients — list parties by type (default real `client`s; P4.1). Pass
 *      `?type=client|prospect|lead|partner|internal` for a specific party set.
 *      Admin-only fee/contract fields are redacted for non-admins.
 * POST /api/clients — create a client/party (Admin only, docs/05 §D14).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { CLIENT_CADENCES, CLIENT_TYPES, FEE_TIERS } from '@gracie/shared';
import type { ClientCadence, ClientType, FeeTier } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { backfillOrgDomains } from '@/lib/data/calendar';
import { createClient, listClients, redactClientForRole } from '@/lib/data/clients';

/** Every non-internal party type — the "link an existing org" picker set. */
const NON_INTERNAL_TYPES: readonly ClientType[] = ['client', 'prospect', 'lead', 'partner'];

/**
 * Resolve the `?type=` filter into the party types to list. `all` = every
 * non-internal org (the meeting "link existing" picker); a specific value =
 * that type; absent = the default real-`client` roster.
 */
function resolveTypes(value: string | null): readonly ClientType[] | undefined {
  if (value === 'all') return NON_INTERNAL_TYPES;
  if (value !== null && (CLIENT_TYPES as readonly string[]).includes(value)) {
    return [value as ClientType];
  }
  return undefined;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);
    const clients = await listClients(resolveTypes(request.nextUrl.searchParams.get('type')));
    const payload = clients.map((c) => redactClientForRole(c, admin));
    return NextResponse.json({ clients: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'clients_list_failed', message } },
      { status: 500 },
    );
  }
}

function asCadence(value: unknown): ClientCadence | undefined {
  return typeof value === 'string' && (CLIENT_CADENCES as readonly string[]).includes(value)
    ? (value as ClientCadence)
    : undefined;
}

function asType(value: unknown): ClientType | undefined {
  return typeof value === 'string' && (CLIENT_TYPES as readonly string[]).includes(value)
    ? (value as ClientType)
    : undefined;
}

function asFeeTier(value: unknown): FeeTier | undefined {
  return typeof value === 'string' && (FEE_TIERS as readonly string[]).includes(value)
    ? (value as FeeTier)
    : undefined;
}

function asTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asDomains(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const domains = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return domains.length > 0 ? domains : undefined;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin only' } },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = asTrimmed(body.name);
    if (name === undefined) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Client name is required.' } },
        { status: 400 },
      );
    }

    const contractValue =
      typeof body.contractValue === 'number' && Number.isFinite(body.contractValue)
        ? body.contractValue
        : undefined;

    const domains = asDomains(body.domains);
    const client = await createClient({
      name,
      type: asType(body.type),
      initials: asTrimmed(body.initials),
      cadence: asCadence(body.cadence),
      description: asTrimmed(body.description),
      primaryContact: asTrimmed(body.primaryContact),
      primaryContactEmail: asTrimmed(body.primaryContactEmail),
      contractNumber: asTrimmed(body.contractNumber),
      feeTier: asFeeTier(body.feeTier),
      contractValue,
      domains,
    });

    // Retroactively link existing meetings on the new org's domains (P4.1), so the
    // roster/calendar reflect history immediately instead of after the next scan.
    if (domains !== undefined) await backfillOrgDomains(client.id, domains);

    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_create_failed', message } },
      { status: 500 },
    );
  }
}
