/**
 * A single office (phase `CO`).
 *   PATCH  /api/clients/:clientId/offices/:officeId  { title?, parentOfficeId?, description?, isKey?, sortOrder? }
 *   DELETE /api/clients/:clientId/offices/:officeId  → children reparent to root; holders become freeform.
 * Editor tier. `parentOfficeId` guards self-reference + reporting cycles in the data layer.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, requireEditor } from '@/lib/contacts-api';
import { deleteOffice, updateOffice, type OfficePatch } from '@/lib/data/contacts';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string; officeId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { officeId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // `parentOfficeId` present → set (a non-empty string) or clear to root (null/empty).
    const parentOfficeId =
      'parentOfficeId' in body
        ? typeof body.parentOfficeId === 'string' && body.parentOfficeId.trim() !== ''
          ? body.parentOfficeId.trim()
          : null
        : undefined;
    const description =
      'description' in body
        ? typeof body.description === 'string'
          ? body.description
          : null
        : undefined;
    const patch: OfficePatch = {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(parentOfficeId !== undefined ? { parentOfficeId } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(typeof body.isKey === 'boolean' ? { isKey: body.isKey } : {}),
      ...(typeof body.sortOrder === 'number' ? { sortOrder: body.sortOrder } : {}),
    };

    const office = await updateOffice(officeId, patch);
    return NextResponse.json({ office });
  } catch (error) {
    return fail(error, 'office_update_failed');
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
    await deleteOffice(officeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'office_delete_failed');
  }
}
