/**
 * GET /api/clients — list clients.
 *
 * Reads via the service-role data layer; gates admin-only fields (fee tier,
 * contract value) by role (docs/02 §D14). Auth currently resolves to the mock
 * user via getRequestUser() — replaced by Logto JWT verification later.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { listClients, redactClientForRole } from '@/lib/data/clients';

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
