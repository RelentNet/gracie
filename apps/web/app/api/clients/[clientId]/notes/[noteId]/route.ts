/**
 * PATCH  /api/clients/:clientId/notes/:noteId { content } — edit a note.
 * DELETE /api/clients/:clientId/notes/:noteId               — delete a note.
 *
 * Editor tier to reach either; a note may be edited/deleted only by its AUTHOR or an
 * admin. Author identity is the request user resolved to a `users.id` (null in
 * mock/dev), so in production an admin can always moderate while a standard user
 * manages only their own notes.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin, isEditor } from '@/lib/api-auth';
import {
  deleteClientNote,
  getClientNote,
  updateClientNote,
} from '@/lib/data/client-detail';
import { getUserIdByLogtoId } from '@/lib/data/users';

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'forbidden', message } }, { status: 403 });
}

function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: 'note_not_found', message: 'Note not found' } },
    { status: 404 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string; noteId: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isEditor(user)) return forbidden('Editor access required');
    const { noteId } = await params;
    const note = await getClientNote(noteId);
    if (note === null) return notFound();

    const authorId = await getUserIdByLogtoId(user.userId);
    const isAuthor = note.authorUserId !== null && note.authorUserId === authorId;
    if (!isAuthor && !isAdmin(user)) return forbidden('You can only edit your own notes.');

    const body = (await request.json().catch(() => ({}))) as { content?: unknown };
    if (typeof body.content !== 'string' || body.content.trim() === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Note content is required.' } },
        { status: 400 },
      );
    }
    const updated = await updateClientNote(noteId, body.content);
    return NextResponse.json({ note: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'Unknown note' ? 404 : 500;
    return NextResponse.json({ error: { code: 'note_update_failed', message } }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string; noteId: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isEditor(user)) return forbidden('Editor access required');
    const { noteId } = await params;
    const note = await getClientNote(noteId);
    if (note === null) return notFound();

    const authorId = await getUserIdByLogtoId(user.userId);
    const isAuthor = note.authorUserId !== null && note.authorUserId === authorId;
    if (!isAuthor && !isAdmin(user)) return forbidden('You can only delete your own notes.');

    await deleteClientNote(noteId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'note_delete_failed', message } }, { status: 500 });
  }
}
