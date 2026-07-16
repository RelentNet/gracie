/**
 * POST /api/staff/move { documentId, destinationFolderId }
 *
 * Refile a Gracie Files (GF) staff document into another staff folder. Editor-only.
 * The MinIO object is moved under the destination folder's key prefix (copy +
 * delete) and the row's `folder_id` + `r2_key` are updated together.
 *
 * SECURITY (docs/02 §D14): both source and destination keys are authorized against
 * folder visibility via `canAccessKey`, so a non-admin can neither move a doc OUT of
 * nor INTO a restricted (Admin-only) staff folder. Only staff documents/folders are
 * addressable here (client docs are rejected as not-found).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { moveObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canAccessKey, canEditRole } from '@/lib/data/files';
import { moveDocumentToFolder } from '@/lib/data/documents';
import { getStaffDocument, getStaffFolderById } from '@/lib/data/staff-drive';

export const runtime = 'nodejs';

interface MoveStaffDocumentBody {
  readonly documentId?: string;
  readonly destinationFolderId?: string;
}

/** Last path segment of a storage key (the file portion). */
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

    const body = (await req.json().catch(() => ({}))) as MoveStaffDocumentBody;
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

    const [staffDoc, dest] = await Promise.all([
      getStaffDocument(documentId),
      getStaffFolderById(destinationFolderId),
    ]);
    if (staffDoc === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Staff document not found' } },
        { status: 404 },
      );
    }
    if (dest === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Destination folder not found' } },
        { status: 404 },
      );
    }
    // A non-admin may not move INTO a restricted (Admin-only) folder.
    if (dest.visibility === 'restricted' && !admin) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for the destination folder' } },
        { status: 403 },
      );
    }

    const doc = staffDoc.document;
    // Destination key lives under the folder's path so its authorization governs.
    const destinationKey = `${dest.path}/${Date.now()}-${basename(doc.r2Key)}`;
    const [srcOk, dstOk] = await Promise.all([
      canAccessKey(doc.r2Key, admin),
      canAccessKey(destinationKey, admin),
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
    return NextResponse.json({ error: { code: 'staff_move_failed', message } }, { status: 500 });
  }
}
