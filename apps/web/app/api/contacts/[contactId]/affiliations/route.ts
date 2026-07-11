/**
 * A contact's affiliations (phase `CO`).
 *   GET  /api/contacts/:contactId/affiliations                 → list (current + past)
 *   POST /api/contacts/:contactId/affiliations { clientId?, officeId?, title?, … }
 *        → create a current affiliation (filling an office ends its prior holder).
 * Read = `contacts.view`; create = editor.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, fail, requireEditor, requireViewer, str } from '@/lib/contacts-api';
import { createAffiliation, listAffiliationsForContact } from '@/lib/data/contacts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const { contactId } = await params;
    const affiliations = await listAffiliationsForContact(contactId);
    return NextResponse.json({ affiliations });
  } catch (error) {
    return fail(error, 'affiliations_list_failed');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { contactId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const clientId = str(body.clientId);
    const officeId = str(body.officeId);
    if (clientId === null && officeId === null) {
      return badRequest('An organization or office is required.');
    }

    const affiliation = await createAffiliation({
      contactId,
      clientId: clientId ?? undefined,
      officeId,
      title: str(body.title),
      orgEmail: str(body.orgEmail),
      orgPhone: str(body.orgPhone),
      startedOn: str(body.startedOn),
      notes: str(body.notes),
    });
    return NextResponse.json({ affiliation }, { status: 201 });
  } catch (error) {
    return fail(error, 'affiliation_create_failed');
  }
}
