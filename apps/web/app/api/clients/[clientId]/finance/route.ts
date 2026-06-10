/**
 * GET /api/clients/:clientId/finance — Finance tab data. ADMIN ONLY.
 *
 * Non-admin roles receive a 403 (docs/02 §D14) — the finance tab is also hidden
 * in the client layout, so this is defense-in-depth for a direct API call. The
 * client is returned WITH its admin-only fee fields (no redaction) since only
 * admins reach this point. Auth resolves to the mock user via getRequestUser().
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getClientDetail } from '@/lib/data/client-detail';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin only' } },
        { status: 403 },
      );
    }
    const { clientId } = await params;
    const client = await getClientDetail(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'client_not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    return NextResponse.json({ client });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_finance_failed', message } },
      { status: 500 },
    );
  }
}
