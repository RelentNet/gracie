/**
 * POST /api/folders/[id]/restore — bring a deleted folder back from the recycle bin.
 *
 * Restores the folder's entire `delete_batch_id`: the folder, every descendant folder,
 * and every document that went down with it. Restoring only the folder would leave its
 * contents stranded in the bin with no obvious way to reach them.
 *
 * Also restores any deleted ancestors above it, so a subtree restored on its own lands
 * somewhere navigable rather than under a still-deleted parent.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { can } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import {
  getFolderById,
  restoreAncestorFolders,
  restoreDeleteBatch,
} from '@/lib/data/folders';
import { enqueueIngest } from '@/lib/queue';
import { getDocumentById } from '@/lib/data/documents';

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
    if (!can(user.role, 'folder.delete')) {
      return jsonError('forbidden', 'Restoring folders requires admin', 403);
    }

    const { id } = await params;
    const folder = await getFolderById(id);
    if (folder === null || folder.deletedAt === null) {
      return jsonError('not_found', 'Folder not found in the recycle bin', 404);
    }
    // `isUnderPath` treats a path as containing itself, so this restores the folder
    // AND every deleted ancestor above it in one call. A folder with no batch id
    // (only reachable via a partially-failed cascade) therefore still comes back.
    await restoreAncestorFolders(folder.path);

    const documentIds =
      folder.deleteBatchId === null ? [] : await restoreDeleteBatch(folder.deleteBatchId);

    // Rebuild AI recall for everything that came back. Best-effort per document — a
    // Redis hiccup must not undo a successful restore.
    for (const documentId of documentIds) {
      try {
        const doc = await getDocumentById(documentId);
        if (doc === null) continue;
        await enqueueIngest({
          documentId: doc.id,
          clientId: doc.clientId ?? '',
          objectKey: doc.r2Key,
          fileName: doc.fileName,
          mimeType: null,
        });
      } catch (ingestError) {
        console.error('folder restore: re-ingest enqueue failed:', ingestError);
      }
    }

    return NextResponse.json({ ok: true, documentCount: documentIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('folder_restore_failed', message, 500);
  }
}
