/**
 * Accept a contact suggestion (phase `CO`).
 *   POST /api/contact-suggestions/:id/accept { clientId?, officeId?, title? }
 * Reuses an existing contact with the same email or creates one, optionally affiliates
 * it to the guessed/overridden org (+ office), and marks the suggestion accepted.
 * Editor tier. Pass `clientId: null` to accept the contact without an affiliation.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, optionalActorId, requireEditor, str } from '@/lib/contacts-api';
import { acceptSuggestion, type AcceptSuggestionInput } from '@/lib/data/contacts';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Presence-sensitive: a null override means "accept without affiliating".
    const input: AcceptSuggestionInput = {
      resolvedByUserId: await optionalActorId(),
      title: str(body.title),
      ...('clientId' in body ? { clientId: str(body.clientId) } : {}),
      ...('officeId' in body ? { officeId: str(body.officeId) } : {}),
    };

    const result = await acceptSuggestion(id, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return fail(error, 'suggestion_accept_failed');
  }
}
