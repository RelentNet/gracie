/**
 * An office's current holder (phase `CO`) — the "fill / vacate an office" action.
 *   POST   /api/clients/:clientId/offices/:officeId/holder { contactId, startedOn?, … }
 *          → set (or replace) the holder; the prior current holder is ended first.
 *   DELETE /api/clients/:clientId/offices/:officeId/holder → vacate (end current holder).
 * Editor tier.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, fail, requireEditor, str } from '@/lib/contacts-api';
import { setOfficeHolder, vacateOffice } from '@/lib/data/contacts';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; officeId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { officeId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.contactId !== 'string' || body.contactId.trim() === '') {
      return badRequest('A contact is required.');
    }
    const affiliation = await setOfficeHolder(officeId, body.contactId.trim(), {
      startedOn: str(body.startedOn),
      title: str(body.title),
      orgEmail: str(body.orgEmail),
      orgPhone: str(body.orgPhone),
      notes: str(body.notes),
    });
    return NextResponse.json({ affiliation }, { status: 201 });
  } catch (error) {
    return fail(error, 'office_holder_failed');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string; officeId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { officeId } = await params;
    await vacateOffice(officeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'office_vacate_failed');
  }
}
