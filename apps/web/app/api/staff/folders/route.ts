/**
 * Gracie Files (GF) — staff-drive folders.
 *
 *   GET  /api/staff/folders  — list the staff tree (`kind='staff'`), ensuring the
 *        `staff/` root folder exists. Returns the root id for initial selection.
 *   POST /api/staff/folders  — create a staff subfolder (editors; Admins may mark
 *        it restricted). Mirrors `POST /api/folders` but is fixed to the internal
 *        GA org + a `staff/` path root + `kind='staff'`.
 *
 * SECURITY (docs/02 §D14): restricted folders are OMITTED for non-admins
 * (`filterVisibleFolders`); only Admins create a restricted folder or nest under
 * one. Reuses the same authorities as the client folder routes — nothing weakened.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import { filterVisibleFolders } from '@/lib/data/documents';
import { createFolder, folderSegment } from '@/lib/data/folders';
import { getUserIdByLogtoId } from '@/lib/data/users';
import {
  STAFF_ROOT,
  ensureStaffRoot,
  getStaffFolderById,
  listStaffFolders,
} from '@/lib/data/staff-drive';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);
    const { rootFolderId } = await ensureStaffRoot();
    const folders = filterVisibleFolders(await listStaffFolders(), admin);
    return NextResponse.json({ folders, rootFolderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'staff_folders_list_failed', message } },
      { status: 500 },
    );
  }
}

interface CreateStaffFolderBody {
  readonly parentFolderId?: string | null;
  readonly name?: string;
  readonly restricted?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!canEditRole(user.role)) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Creating folders requires editor role' } },
        { status: 403 },
      );
    }
    const admin = isAdmin(user);

    const body = (await request.json().catch(() => ({}))) as CreateStaffFolderBody;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name === '') {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Folder name is required' } },
        { status: 400 },
      );
    }
    const restricted = body.restricted === true;
    if (restricted && !admin) {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Only admins can create restricted folders' } },
        { status: 403 },
      );
    }

    const { orgId, rootFolderId } = await ensureStaffRoot();

    // Base path: the selected parent staff folder, or the `staff/` root.
    let basePath = STAFF_ROOT;
    const parentId = typeof body.parentFolderId === 'string' ? body.parentFolderId : null;
    if (parentId !== null && parentId !== rootFolderId) {
      const parent = await getStaffFolderById(parentId);
      if (parent === null) {
        return NextResponse.json(
          { error: { code: 'bad_request', message: 'Invalid parent folder' } },
          { status: 400 },
        );
      }
      // Cannot nest under a restricted folder you cannot see.
      if (parent.visibility === 'restricted' && !admin) {
        return NextResponse.json(
          { error: { code: 'forbidden', message: 'Not authorized for the parent folder' } },
          { status: 403 },
        );
      }
      basePath = parent.path;
    }

    const createdByUserId = await getUserIdByLogtoId(user.userId);
    const path = `${basePath}/${folderSegment(name)}`;
    const folder = await createFolder({
      clientId: orgId,
      path,
      displayName: name,
      restricted,
      createdByUserId,
      kind: 'staff',
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'staff_folder_create_failed', message } },
      { status: 500 },
    );
  }
}
