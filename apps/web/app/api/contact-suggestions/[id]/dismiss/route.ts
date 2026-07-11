/**
 * Dismiss a contact suggestion (phase `CO`).
 *   POST /api/contact-suggestions/:id/dismiss → marks it dismissed; it won't resurface
 *        (the generator skips emails that already have a dismissed suggestion).
 * Editor tier.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { fail, optionalActorId, requireEditor } from '@/lib/contacts-api';
import { dismissSuggestion } from '@/lib/data/contacts';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const gate = await requireEditor();
    if (gate instanceof NextResponse) return gate;
    const { id } = await params;
    await dismissSuggestion(id, await optionalActorId());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'suggestion_dismiss_failed');
  }
}
