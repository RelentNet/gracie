/**
 * DELETE /api/staff/folders/:id — recursively delete a Gracie Files (GF) staff
 * folder and everything beneath it.
 *
 * ADMIN-ONLY (`folder.delete`). Deletes every document in the subtree — object +
 * `documents` row + `embeddings` — then the folder rows (children first via the
 * doc pass, so no `documents.folder_id` FK is left dangling). The `staff/` root
 * itself cannot be deleted (it is re-ensured on next load). Only staff folders are
 * addressable here (client folders → 404).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { deleteObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import {
  STAFF_ROOT,
  deleteDocumentRecords,
  deleteFolderRecords,
  getStaffFolderById,
  getStaffFolderSubtree,
} from '@/lib/data/staff-drive';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Deleting folders requires admin' } },
        { status: 403 },
      );
    }

    const { id } = await params;
    const folder = await getStaffFolderById(id);
    if (folder === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Staff folder not found' } },
        { status: 404 },
      );
    }
    if (folder.path === STAFF_ROOT) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'The Gracie Files root cannot be deleted' } },
        { status: 400 },
      );
    }

    const { folders, documents } = await getStaffFolderSubtree(folder);

    // Delete each document's object + embeddings + row before removing folder rows.
    for (const doc of documents) {
      await deleteObject(doc.r2Key);
      await deleteDocumentRecords(doc.id);
    }
    await deleteFolderRecords(folders.map((f) => f.id));

    return NextResponse.json({
      ok: true,
      deletedFolders: folders.length,
      deletedDocuments: documents.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'staff_folder_delete_failed', message } },
      { status: 500 },
    );
  }
}
