/**
 * GET  /api/clients/:clientId/notes — Notes tab data (newest first).
 * POST /api/clients/:clientId/notes { content } — add a note (editor tier).
 *
 * Author name/initials resolution is a display concern handled in the UI. Auth
 * resolves via getRequestUser(); the note's author is the resolved request user.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isEditor } from '@/lib/api-auth';
import { createClientNote, getClientDetail, getClientNotes } from '@/lib/data/client-detail';
import { getUserIdByLogtoId } from '@/lib/data/users';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const { clientId } = await params;
    const client = await getClientDetail(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'client_not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    const notes = await getClientNotes(clientId);
    return NextResponse.json({ notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_notes_failed', message } },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isEditor(user)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Editor access required' } },
        { status: 403 },
      );
    }
    const { clientId } = await params;
    const client = await getClientDetail(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'client_not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as { content?: unknown };
    if (typeof body.content !== 'string' || body.content.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Note content is required.' } },
        { status: 400 },
      );
    }
    // Resolve the request identity to a `users.id` (the author FK). Null in mock/dev
    // (no matching logto_id row) — the note still saves, authored anonymously.
    const authorId = await getUserIdByLogtoId(user.userId);
    const note = await createClientNote(clientId, body.content, authorId);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'client_notes_failed', message } },
      { status: 500 },
    );
  }
}
