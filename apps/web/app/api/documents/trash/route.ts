/**
 * GET /api/documents/trash — the recycle bin.
 *
 * SCOPE: admins see everything in the bin; editors see only what they deleted
 * themselves; viewers get 403 and have no bin in the UI at all.
 *
 * The response carries `retentionDays` and a per-item `purgesAt` so the UI can show a
 * countdown without hardcoding the window — retention is an operator setting, and the
 * number the user sees must be the number the purge sweep actually uses.
 *
 * Items here are INERT: the payload deliberately carries no download URL, and
 * `/api/files/url` refuses keys belonging to deleted rows, so a bin item cannot be
 * fetched without restoring it first.
 */
import { NextResponse } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { listTrash } from '@/lib/data/documents';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { getTrashRetentionDays } from '@/lib/data/settings-documents';

export const runtime = 'nodejs';

/** `deleted_at` + retention, as an ISO instant. */
function purgesAt(deletedAt: string, retentionDays: number): string {
  return new Date(new Date(deletedAt).getTime() + retentionDays * 86_400_000).toISOString();
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'file.deleteOwn') && !can(user.role, 'file.deleteAny')) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'The recycle bin requires editor role' } },
        { status: 403 },
      );
    }

    // Admins see the whole bin; everyone else is scoped to their own deletions. A
    // caller whose internal user row can't be resolved is scoped to nothing rather
    // than to everything — failing closed.
    const scopeToSelf = !can(user.role, 'file.deleteAny');
    const callerId = scopeToSelf ? await getUserIdByLogtoId(user.userId).catch(() => null) : null;
    if (scopeToSelf && callerId === null) {
      return NextResponse.json({ documents: [], folders: [], retentionDays: 0 });
    }

    const [{ documents, folders }, retentionDays] = await Promise.all([
      listTrash(callerId),
      getTrashRetentionDays(),
    ]);

    return NextResponse.json({
      retentionDays,
      documents: documents.map((doc) => ({
        ...doc,
        purgesAt: doc.deletedAt === null ? null : purgesAt(doc.deletedAt, retentionDays),
      })),
      folders: folders.map((folder) => ({
        ...folder,
        purgesAt: folder.deletedAt === null ? null : purgesAt(folder.deletedAt, retentionDays),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'trash_list_failed', message } }, { status: 500 });
  }
}
