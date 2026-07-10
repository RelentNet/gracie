/**
 * Org-wide contact export (phase `CO`).
 *   GET /api/clients/:clientId/contacts/export?includePast=
 * A `text/csv` of the org's affiliations (contact, email/phone, office/title, tenure),
 * named after the org, with a `Content-Disposition` attachment header for mobile.
 * Read gate (`contacts.view`, all roles).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, requireViewer } from '@/lib/contacts-api';
import { getClient } from '@/lib/data/clients';
import { listAffiliationsForOrg, orgAffiliationsToCsv } from '@/lib/data/contacts';

/** A filesystem-safe basename derived from the org's name. */
function safeBase(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'org' : cleaned;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const { clientId } = await params;
    const includePast = request.nextUrl.searchParams.get('includePast') === 'true';

    const [org, affiliations] = await Promise.all([
      getClient(clientId),
      listAffiliationsForOrg(clientId, includePast),
    ]);
    const filename = `${safeBase(org?.name ?? 'org')}-contacts.csv`;
    const body = orgAffiliationsToCsv(affiliations);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return fail(error, 'org_contacts_export_failed');
  }
}
