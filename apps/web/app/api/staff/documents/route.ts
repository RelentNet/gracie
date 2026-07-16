/**
 * GET /api/staff/documents — list the Gracie Files (GF) staff-drive documents.
 *
 * SECURITY (docs/02 §D14): documents in a restricted staff folder are OMITTED for
 * non-admins — the SAME `filterVisibleFolders` + `filterVisibleDocuments`
 * authorities the client Documents route uses. Only staff-drive documents
 * (`kind='staff'` folders) are returned here; client documents never appear.
 */
import { NextResponse } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { filterVisibleDocuments, filterVisibleFolders } from '@/lib/data/documents';
import { listStaffDocuments, listStaffFolders } from '@/lib/data/staff-drive';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);

    const [documents, folders] = await Promise.all([listStaffDocuments(), listStaffFolders()]);
    const visibleFolders = filterVisibleFolders(folders, admin);
    const payload = filterVisibleDocuments(documents, visibleFolders, admin);

    return NextResponse.json({ documents: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'staff_documents_list_failed', message } },
      { status: 500 },
    );
  }
}
