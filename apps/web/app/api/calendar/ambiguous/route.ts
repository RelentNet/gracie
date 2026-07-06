/**
 * GET /api/calendar/ambiguous — meetings needing manual client assignment
 * (docs/05). Admin only. Returns the ambiguous meetings plus the client options
 * (id + name) so the Admin can assign one without a second fetch. Resolve an
 * assignment via POST /api/calendar/assign.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { listAmbiguousMeetings } from '@/lib/data/calendar';
import { listClients } from '@/lib/data/clients';

export async function GET(): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json({ error: { code: 'forbidden', message: 'Admin only' } }, { status: 403 });
    }
    const [meetings, clients] = await Promise.all([listAmbiguousMeetings(), listClients()]);
    const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
    return NextResponse.json({ meetings, clientOptions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'calendar_ambiguous_failed', message } },
      { status: 500 },
    );
  }
}
