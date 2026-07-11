/**
 * A single contact (phase `CO`).
 *   GET    /api/contacts/:contactId   → contact + full affiliation history
 *   PATCH  /api/contacts/:contactId   → edit details (editor)
 *   DELETE /api/contacts/:contactId   → delete (cascades affiliations → offices vacate) (editor)
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, requireEditor, requireViewer } from '@/lib/contacts-api';
import { deleteContact, getContact, updateContact, type ContactPatch } from '@/lib/data/contacts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const { contactId } = await params;
    const contact = await getContact(contactId);
    if (contact === null) return fail(new Error('Unknown contact'), 'contact_get_failed');
    return NextResponse.json({ contact });
  } catch (error) {
    return fail(error, 'contact_get_failed');
  }
}

/** Read a nullable text field from the body: present → string|null (empty clears). */
function nullableText(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  return typeof body[key] === 'string' ? (body[key] as string) : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { contactId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const email = nullableText(body, 'email');
    const phone = nullableText(body, 'phone');
    const linkedinUrl = nullableText(body, 'linkedinUrl');
    const notes = nullableText(body, 'notes');
    const patch: ContactPatch = {
      ...(typeof body.fullName === 'string' ? { fullName: body.fullName } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(linkedinUrl !== undefined ? { linkedinUrl } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };

    const contact = await updateContact(contactId, patch);
    return NextResponse.json({ contact });
  } catch (error) {
    return fail(error, 'contact_update_failed');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { contactId } = await params;
    await deleteContact(contactId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'contact_delete_failed');
  }
}
