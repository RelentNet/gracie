/**
 * DELETE /api/staff/files/:id — delete a Gracie Files (GF) staff document.
 *
 * Removes the MinIO object, the `documents` row, AND its `embeddings`
 * (`source_type='upload'`) so a deleted staff file leaves no orphaned vector the
 * Assistant could still retrieve. Editor tier = delete-OWN (the uploader);
 * Admin = delete-ANY. `canAccessKey` additionally prevents deleting a file in a
 * restricted staff folder the caller cannot see. Only staff documents are
 * addressable here (client docs → 404).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { deleteObject } from '@gracie/shared/storage';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canAccessKey, canEditRole } from '@/lib/data/files';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { deleteDocumentRecords, getStaffDocument } from '@/lib/data/staff-drive';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Delete requires editor role' } },
        { status: 403 },
      );
    }
    const admin = isAdmin(user);

    const { id } = await params;
    const staffDoc = await getStaffDocument(id);
    if (staffDoc === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Staff document not found' } },
        { status: 404 },
      );
    }
    const doc = staffDoc.document;

    // Cannot delete a file in a restricted staff folder you cannot see.
    if (!(await canAccessKey(doc.r2Key, admin))) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Not authorized for this path' } },
        { status: 403 },
      );
    }

    // Non-admins may delete only their OWN uploads (file.deleteOwn); admins any.
    if (!admin) {
      const callerUserId = await getUserIdByLogtoId(user.userId);
      if (callerUserId === null || doc.uploadedByUserId !== callerUserId) {
        return NextResponse.json(
          { error: { code: 'forbidden', message: 'You can only delete files you uploaded' } },
          { status: 403 },
        );
      }
    }

    // Object first (idempotent — missing key is a no-op), then the DB records.
    await deleteObject(doc.r2Key);
    await deleteDocumentRecords(doc.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'staff_file_delete_failed', message } },
      { status: 500 },
    );
  }
}
