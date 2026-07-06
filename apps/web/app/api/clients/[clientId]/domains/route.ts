/**
 * Org domains manager (P4.1 follow-on). A domain is the primary calendar→org
 * match key (`client_domains`, globally unique), so managing an org's domains
 * controls which meetings link to it.
 *   GET    /api/clients/:clientId/domains            → list registered domains
 *   POST   /api/clients/:clientId/domains { domain }  → register + backfill history
 *   DELETE /api/clients/:clientId/domains?domain=…    → unregister (existing links stay)
 * Editor tier (admin + standard); viewers are read-only. Registering a domain
 * retroactively links every existing meeting on it — this is what fixes a
 * multi-domain client (e.g. adding `us.ibm.com` to the IBM org). Error shape
 * mirrors the meeting-orgs route.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { addClientDomain, listClientDomains, removeClientDomain } from '@/lib/data/clients';

function forbidden(): NextResponse {
  return NextResponse.json(
    { error: { code: 'forbidden', message: 'Editor access required' } },
    { status: 403 },
  );
}

/**
 * Map a thrown error to a response. "Unknown client" → 404; clean validation
 * sentences (free-email / internal / taken / required) → 400; any wrapped internal
 * error (`fn: detail`) → 500.
 */
function fail(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const status = message === 'Unknown client' ? 404 : message.includes(': ') ? 500 : 400;
  return NextResponse.json({ error: { code: 'client_domains_failed', message } }, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    if (!isEditor(await getRequestUser())) return forbidden();
    const { clientId } = await params;
    const domains = await listClientDomains(clientId);
    return NextResponse.json({ domains });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    if (!isEditor(await getRequestUser())) return forbidden();
    const { clientId } = await params;
    const body = (await request.json().catch(() => ({}))) as { domain?: unknown };
    if (typeof body.domain !== 'string' || body.domain.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A domain is required.' } },
        { status: 400 },
      );
    }
    const domains = await addClientDomain(clientId, body.domain);
    return NextResponse.json({ domains }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    if (!isEditor(await getRequestUser())) return forbidden();
    const { clientId } = await params;
    const domain = request.nextUrl.searchParams.get('domain');
    if (domain === null || domain.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'A domain is required.' } },
        { status: 400 },
      );
    }
    const domains = await removeClientDomain(clientId, domain);
    return NextResponse.json({ domains });
  } catch (error) {
    return fail(error);
  }
}
