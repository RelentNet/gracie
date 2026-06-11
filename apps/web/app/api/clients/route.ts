/**
 * GET  /api/clients — list clients (admin-only fee/contract fields redacted).
 * POST /api/clients — create a client (Admin only, docs/05 §D14).
 */
import { NextResponse } from 'next/server';

import { CLIENT_CADENCES, FEE_TIERS } from '@gracie/shared';
import type { ClientCadence, FeeTier } from '@gracie/shared';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { createClient, listClients, redactClientForRole } from '@/lib/data/clients';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);
    const clients = await listClients();
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

function asFeeTier(value: unknown): FeeTier | undefined {
  return typeof value === 'string' && (FEE_TIERS as readonly string[]).includes(value)
    ? (value as FeeTier)
    : undefined;
}

function asTrimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
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

    const client = await createClient({
      name,
      initials: asTrimmed(body.initials),
      cadence: asCadence(body.cadence),
      description: asTrimmed(body.description),
      primaryContact: asTrimmed(body.primaryContact),
      primaryContactEmail: asTrimmed(body.primaryContactEmail),
      contractNumber: asTrimmed(body.contractNumber),
      feeTier: asFeeTier(body.feeTier),
      contractValue,
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_create_failed', message } },
      { status: 500 },
    );
  }
}
