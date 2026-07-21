/**
 * POST /api/documents/move { documentId, destinationFolderId }
 *
 * Refile a document into another folder (docs/plan p2fix §4). Editor-only. The
 * MinIO object is moved under the destination folder's R2 prefix (copy + delete)
 * and the row's `folder_id` + `r2_key` are updated together.
 *
 * SECURITY-CRITICAL (docs/02 §D14): both the source and destination paths are
 * authorized against folder visibility, and a non-admin may neither move a doc
 * OUT of nor INTO a restricted (Admin-only) folder. Documents stay within their
 * own client.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { moveObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canAccessKey, canEditRole } from '@/lib/data/files';
import { getDocumentById, moveDocumentToFolder } from '@/lib/data/documents';
import { getFolderById } from '@/lib/data/folders';

// bullmq/ioredis-free, but storage is Node-only — force the Node.js runtime.
export const runtime = 'nodejs';

interface MoveDocumentBody {
  readonly documentId?: string;
  readonly destinationFolderId?: string;
}

/** Last path segment of an R2 key (the file portion). */
function basename(key: string): string {
  const index = key.lastIndexOf('/');
  return index === -1 ? key : key.slice(index + 1);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Move requires editor role' } },
        { status: 403 },
      );
    }
    const admin = isAdmin(user);

    const body = (await req.json().catch(() => ({}))) as MoveDocumentBody;
    const { documentId, destinationFolderId } = body;
    if (
      documentId === undefined ||
      documentId === '' ||
      destinationFolderId === undefined ||
      destinationFolderId === ''
    ) {
      return NextResponse.json(
        {
          error: {
            code: 'bad_request',
            message: 'documentId and destinationFolderId are required',
          },
        },
        { status: 400 },
      );
    }

    const [doc, dest] = await Promise.all([
      getDocumentById(documentId),
      getFolderById(destinationFolderId),
    ]);
    if (doc === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Document not found' } },
        { status: 404 },
      );
    }
    if (dest === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Destination folder not found' } },
        { status: 404 },
      );
    }
    if (dest.clientId !== doc.clientId) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Cannot move a document to another client' } },
        { status: 400 },
      );
    }
    // A non-admin may not move INTO a restricted (Admin-only) folder.
    if (dest.visibility === 'restricted' && !admin) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for the destination folder' } },
        { status: 403 },
      );
    }

    // Destination key lives under the folder's path so its authorization governs.
    const destinationKey = `${dest.path}/${Date.now()}-${basename(doc.r2Key)}`;
    const [srcOk, dstOk] = await Promise.all([
      canAccessKey(doc.r2Key, user.role),
      canAccessKey(destinationKey, user.role),
    ]);
    if (!srcOk || !dstOk) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for one of the paths' } },
        { status: 403 },
      );
    }

    await moveObject(doc.r2Key, destinationKey);
    await moveDocumentToFolder(documentId, destinationFolderId, destinationKey);

    return NextResponse.json({ ok: true, r2Key: destinationKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'move_failed', message } }, { status: 500 });
  }
}
