/**
 * Contact suggestions inbox (phase `CO`).
 *   GET /api/contact-suggestions → pending suggestions (source-agnostic: calendar
 *       attendees now, a future n8n web-scan later), enriched with the guessed org +
 *       source-meeting titles. Read gate (`contacts.view`); accept/dismiss are editor.
 */
import { NextResponse } from 'next/server';

import { fail, requireViewer } from '@/lib/contacts-api';
import { listPendingSuggestions } from '@/lib/data/contacts';

export async function GET(): Promise<NextResponse> {
  try {
    const gate = await requireViewer();
    if (gate instanceof NextResponse) return gate;
    const suggestions = await listPendingSuggestions();
    return NextResponse.json({ suggestions });
  } catch (error) {
    return fail(error, 'suggestions_list_failed');
  }
}
