/**
 * Contacts collection (phase `CO`).
 *   GET  /api/contacts?clientId=&search=&includePast=  → list contacts (+ affiliations)
 *   POST /api/contacts { fullName, email?, …, clientId?, officeId?, title? }
 *        → create a contact, optionally affiliating it to an org/office in one step.
 * Read = `contacts.view` (all roles); writes = editor tier (`contacts.edit`).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, fail, optionalActorId, requireEditor, requireViewer, str } from '@/lib/contacts-api';
import { createAffiliation, createContact, listContacts } from '@/lib/data/contacts';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const sp = request.nextUrl.searchParams;
    const contacts = await listContacts({
      clientId: sp.get('clientId') ?? undefined,
      search: sp.get('search') ?? undefined,
      includePast: sp.get('includePast') === 'true',
    });
    return NextResponse.json({ contacts });
  } catch (error) {
    return fail(error, 'contacts_list_failed');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.fullName !== 'string' || body.fullName.trim() === '') {
      return badRequest('A contact name is required.');
    }

    const contact = await createContact({
      fullName: body.fullName,
      email: str(body.email),
      phone: str(body.phone),
      linkedinUrl: str(body.linkedinUrl),
      notes: str(body.notes),
      createdByUserId: await optionalActorId(),
    });

    // Optional initial affiliation so "New contact" can attach to an org/office in one step.
    const clientId = str(body.clientId);
    const officeId = str(body.officeId);
    if (clientId !== null || officeId !== null) {
      await createAffiliation({
        contactId: contact.id,
        clientId: clientId ?? undefined,
        officeId,
        title: str(body.title),
        startedOn: str(body.startedOn),
      });
    }

    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return fail(error, 'contact_create_failed');
  }
}
