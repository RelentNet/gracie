/**
 * An org's offices — the org-chart nodes (phase `CO`).
 *   GET  /api/clients/:clientId/offices                  → flat office list
 *   POST /api/clients/:clientId/offices { title, parentOfficeId?, description?, isKey?, sortOrder? }
 * Read = `contacts.view`; create = editor. Offices can be VACANT (no holder).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, fail, requireEditor, requireViewer, str } from '@/lib/contacts-api';
import { createOffice, listOffices } from '@/lib/data/contacts';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const { clientId } = await params;
    const offices = await listOffices(clientId);
    return NextResponse.json({ offices });
  } catch (error) {
    return fail(error, 'offices_list_failed');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { clientId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return badRequest('An office title is required.');
    }
    const office = await createOffice({
      clientId,
      title: body.title,
      parentOfficeId: str(body.parentOfficeId),
      description: str(body.description),
      isKey: body.isKey === true,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    return NextResponse.json({ office }, { status: 201 });
  } catch (error) {
    return fail(error, 'office_create_failed');
  }
}
