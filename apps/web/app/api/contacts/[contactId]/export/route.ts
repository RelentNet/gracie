/**
 * Per-contact export (phase `CO`).
 *   GET /api/contacts/:contactId/export?format=csv|vcard
 * Returns a downloadable `text/csv` (contact + affiliation history) or `text/vcard`
 * (imports straight into a phone address book) with a `Content-Disposition` filename,
 * so it downloads reliably on mobile. Read gate (`contacts.view`, all roles).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, requireViewer } from '@/lib/contacts-api';
import { contactToCsv, contactToVCard, getContact } from '@/lib/data/contacts';

/** A filesystem-safe basename derived from the contact's name. */
function safeBase(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'contact' : cleaned;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const { contactId } = await params;
    const contact = await getContact(contactId);
    if (contact === null) return fail(new Error('Unknown contact'), 'contact_export_failed');

    const base = safeBase(contact.fullName);
    const isVcard = request.nextUrl.searchParams.get('format') === 'vcard';
    const body = isVcard ? contactToVCard(contact) : contactToCsv(contact);
    const contentType = isVcard ? 'text/vcard; charset=utf-8' : 'text/csv; charset=utf-8';
    const filename = isVcard ? `${base}.vcf` : `${base}.csv`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return fail(error, 'contact_export_failed');
  }
}
