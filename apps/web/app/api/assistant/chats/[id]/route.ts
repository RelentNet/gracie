/**
 * GET    /api/assistant/chats/:id — load MY conversation's messages.
 * PATCH  /api/assistant/chats/:id — rename / archive MY conversation.
 * DELETE /api/assistant/chats/:id — delete MY conversation (cascades msgs/files).
 *
 * Any role, own-only. Every handler resolves the caller's `users.id` and passes
 * it to the data layer, which filters `user_id = owner` — a non-owner gets 404
 * (indistinguishable from "does not exist"), never another user's content.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getAssistantUser } from '@/lib/assistant/user';
import { deleteChat, getChatWithMessages, updateChat } from '@/lib/data/assistant';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  let ownerId: string;
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { id } = await params;
    const result = await getChatWithMessages(ownerId, id);
    if (result === null) return jsonError('not_found', 'Conversation not found', 404);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError('chat_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  let ownerId: string;
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: { title?: string; archived?: boolean } = {};
    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (title === '') return jsonError('bad_request', 'title cannot be empty', 400);
      patch.title = title.length > 200 ? title.slice(0, 200) : title;
    }
    if (typeof body.archived === 'boolean') patch.archived = body.archived;
    if (patch.title === undefined && patch.archived === undefined) {
      return jsonError('bad_request', 'Nothing to update (title or archived)', 400);
    }

    const chat = await updateChat(ownerId, id, patch);
    if (chat === null) return jsonError('not_found', 'Conversation not found', 404);
    return NextResponse.json({ chat });
  } catch (error) {
    return jsonError('chat_update_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  let ownerId: string;
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { id } = await params;
    const deleted = await deleteChat(ownerId, id);
    if (!deleted) return jsonError('not_found', 'Conversation not found', 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError('chat_delete_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
