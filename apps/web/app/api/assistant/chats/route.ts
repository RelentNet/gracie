/**
 * GET  /api/assistant/chats — list MY conversations (sidebar).
 * POST /api/assistant/chats — start a new (empty) conversation.
 *
 * Any role. Strictly per-user: the owner id is the caller's resolved `users.id`
 * (never a client-supplied value), so a user only ever sees their own chats.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getActiveProvider } from '@gracie/db';

import { getAssistantUser } from '@/lib/assistant/user';
import { createChat, listChats } from '@/lib/data/assistant';

// @gracie/db (supabase-js, crypto) is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let ownerId: string;
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') ?? undefined;
    const includeArchived = searchParams.get('archived') === 'true';
    const chats = await listChats(ownerId, { search, includeArchived });
    return NextResponse.json({ chats });
  } catch (error) {
    return jsonError('chats_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function POST(): Promise<NextResponse> {
  let ownerId: string;
  try {
    ownerId = (await getAssistantUser()).id;
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { model } = await getActiveProvider();
    const chat = await createChat(ownerId, model);
    return NextResponse.json({ chat }, { status: 201 });
  } catch (error) {
    return jsonError('chat_create_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
