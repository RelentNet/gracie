/**
 * DELETE /api/settings/users/:id/assistant-data — Admin offboarding purge.
 *
 * ADMIN-ONLY and DELETE-ONLY: removes ALL of a user's Assistant data (chats →
 * cascades messages + attachments) and stamps `users.deactivated_at`. It NEVER
 * selects or returns any conversation content — the admin can purge but can never
 * read (spec §5 privacy: "admins never read content"). `:id` is the target
 * `users.id`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { deleteObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { listUserAttachmentKeys, purgeUserAssistantData } from '@/lib/data/assistant';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    if (!isAdmin(await getRequestUser())) {
      return jsonError('forbidden', 'Admin role required', 403);
    }
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }

  try {
    const { id } = await params;
    if (id === '') return jsonError('bad_request', 'user id is required', 400);

    // Collect retained raw-file keys BEFORE the cascade removes their rows, so the
    // MinIO objects can be cleaned up too (nothing here is returned to the admin).
    const keys = await listUserAttachmentKeys(id);
    const { chatsDeleted } = await purgeUserAssistantData(id);
    await Promise.all(
      keys.map((key) =>
        deleteObject(key).catch((e: unknown) => {
          console.error('assistant purge: failed to delete object', key, e);
        }),
      ),
    );

    return NextResponse.json({ ok: true, chatsDeleted });
  } catch (error) {
    return jsonError('purge_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
