/**
 * POST /api/documents/[id]/restore — bring a document back from the recycle bin.
 *
 * Permission to restore mirrors permission to have deleted it: admins restore
 * anything, editors restore what they deleted themselves. Viewers cannot reach the
 * bin at all.
 *
 * Two things happen beyond clearing the tombstone:
 *  - ANCESTORS ARE RESTORED. If the file's folder is still in the bin (it was deleted
 *    as part of a folder cascade, and only this one file is being pulled back), the
 *    folder chain above it comes back too — otherwise the file would return to a
 *    location that renders nowhere in the tree.
 *  - INGESTION IS RE-ENQUEUED. Soft delete drops the document's embeddings so the
 *    assistant stops answering from it; restore rebuilds them. Best-effort: a Redis
 *    outage must not block the user from getting their file back, so a failure here
 *    is logged and the restore still succeeds (the file is usable; only AI recall
 *    lags until the next ingest).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { getDocumentById, restoreDocument } from '@/lib/data/documents';
import { getFolderById, restoreAncestorFolders } from '@/lib/data/folders';
import { enqueueIngest } from '@/lib/queue';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'file.deleteOwn') && !can(user.role, 'file.deleteAny')) {
      return jsonError('forbidden', 'Restoring files requires editor role', 403);
    }

    const { id } = await params;
    const document = await getDocumentById(id);
    if (document === null || document.deletedAt === null) {
      return jsonError('not_found', 'Document not found in the recycle bin', 404);
    }

    const callerId = await getUserIdByLogtoId(user.userId).catch(() => null);
    const isAdminCaller = can(user.role, 'file.deleteAny');
    if (!isAdminCaller && (callerId === null || document.deletedByUserId !== callerId)) {
      // Same 404 a stranger's item would get — the bin must not confirm that
      // someone else deleted something.
      return jsonError('not_found', 'Document not found in the recycle bin', 404);
    }

    if (document.folderId !== null) {
      const folder = await getFolderById(document.folderId);
      if (folder !== null && folder.deletedAt !== null) {
        await restoreAncestorFolders(folder.path);
      }
    }

    const restored = await restoreDocument(id);
    if (restored === null) return jsonError('not_found', 'Document not found in the recycle bin', 404);

    try {
      await enqueueIngest({
        documentId: restored.id,
        clientId: restored.clientId ?? '',
        objectKey: restored.r2Key,
        fileName: restored.fileName,
        mimeType: null,
      });
    } catch (ingestError) {
      console.error('document restore: re-ingest enqueue failed:', ingestError);
    }

    return NextResponse.json({ ok: true, document: restored });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('document_restore_failed', message, 500);
  }
}
