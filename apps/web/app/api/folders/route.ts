/**
 * GET /api/folders?clientId=… — list folders, optionally scoped to a client.
 *
 * SECURITY-CRITICAL (docs/02 §D14, docs/08 §1/§7): restricted-visibility folders
 * (e.g. Transcripts) are OMITTED entirely for non-admins via
 * `filterVisibleFolders` — they never reach the response. Auth currently resolves
 * to the mock user via getRequestUser() — replaced by Logto JWT verification later.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { canEditRole } from '@/lib/data/files';
import { getClient } from '@/lib/data/clients';
import { filterVisibleFolders, listFolders } from '@/lib/data/documents';
import { createFolder, folderSegment, getFolderById } from '@/lib/data/folders';
import { clientSlug } from '@/lib/data/uploads';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const admin = isAdmin(user);
    const clientId = request.nextUrl.searchParams.get('clientId') ?? undefined;
    const folders = await listFolders(clientId);
    const payload = filterVisibleFolders(folders, admin);
    return NextResponse.json({ folders: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'folders_list_failed', message } },
      { status: 500 },
    );
  }
}

interface CreateFolderBody {
  readonly clientId?: string;
  readonly parentFolderId?: string | null;
  readonly name?: string;
  readonly restricted?: boolean;
}

/**
 * POST /api/folders — create a subfolder (editors; docs/plan p2fix §3).
 *
 * The new folder is a child of `parentFolderId` (or the client root when absent).
 * SECURITY (docs/02 §D14): only Admins may create a `restricted` folder, and a
 * folder may only be nested under a parent the requester can see.
 */
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
    const body = (await request.json().catch(() => ({}))) as CreateFolderBody;
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

    const clientId = typeof body.clientId === 'string' && body.clientId !== '' ? body.clientId : null;
    if (clientId === null) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'clientId is required' } },
        { status: 400 },
      );
    }

    const client = await getClient(clientId);
    if (client === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Client not found' } },
        { status: 404 },
      );
    }

    // Base path: the selected parent folder, or the client root.
    let basePath = `clients/${clientSlug(client.name)}`;
    const parentId = typeof body.parentFolderId === 'string' ? body.parentFolderId : null;
    if (parentId !== null) {
      const parent = await getFolderById(parentId);
      if (parent === null || parent.clientId !== clientId) {
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

    const path = `${basePath}/${folderSegment(name)}`;
    const folder = await createFolder({
      clientId,
      path,
      displayName: name,
      restricted,
      createdByUserId: null,
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: { code: 'folder_create_failed', message } },
      { status: 500 },
    );
  }
}
