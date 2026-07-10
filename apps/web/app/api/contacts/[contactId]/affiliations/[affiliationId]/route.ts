/**
 * A single affiliation (phase `CO`).
 *   PATCH /api/contacts/:contactId/affiliations/:affiliationId
 *     { end: true }        → end it (person left/moved; the row stays as history), or
 *     { title?, orgEmail?, orgPhone?, startedOn?, notes? } → edit metadata.
 * Editor tier. Moving orgs/offices is end + create (not an in-place office change).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, requireEditor } from '@/lib/contacts-api';
import { endAffiliation, updateAffiliation, type AffiliationPatch } from '@/lib/data/contacts';

/** Read a nullable text field from the body: present → string|null (empty clears). */
function nullableText(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  return typeof body[key] === 'string' ? (body[key] as string) : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string; affiliationId: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { affiliationId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.end === true) {
      const affiliation = await endAffiliation(affiliationId);
      return NextResponse.json({ affiliation });
    }

    const title = nullableText(body, 'title');
    const orgEmail = nullableText(body, 'orgEmail');
    const orgPhone = nullableText(body, 'orgPhone');
    const startedOn = nullableText(body, 'startedOn');
    const notes = nullableText(body, 'notes');
    const patch: AffiliationPatch = {
      ...(title !== undefined ? { title } : {}),
      ...(orgEmail !== undefined ? { orgEmail } : {}),
      ...(orgPhone !== undefined ? { orgPhone } : {}),
      ...(startedOn !== undefined ? { startedOn } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
    const affiliation = await updateAffiliation(affiliationId, patch);
    return NextResponse.json({ affiliation });
  } catch (error) {
    return fail(error, 'affiliation_update_failed');
  }
}
