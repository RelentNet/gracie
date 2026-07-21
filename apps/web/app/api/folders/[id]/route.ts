/**
 * /api/folders/[id] — manage a single folder.
 *
 *   PATCH  — rename (`displayName`) and/or change permissions (`visibility` +
 *            `allowedRoles`). Requires `folder.manage`; changing the restricted state
 *            requires admin. NEVER touches `path` — see `updateFolder`.
 *   DELETE — recursively move the folder, its descendant folders, and every document
 *            inside them to the recycle bin under one batch id. Admin (`folder.delete`).
 *
 * A folder the caller may not see returns 404, not 403, so these routes cannot be
 * used to probe for restricted folders.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

import { can, canRoleSee, toVisibilityRule, type Role } from '@gracie/shared';

import { getRequestUser } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { getFolderById, softDeleteFolderCascade, updateFolder } from '@/lib/data/folders';
import { parseAclInput, parseName, requiresAdminToApply, type AclInput } from '@/lib/documents-acl';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Load a live folder the role may see, or the 404 to return instead. */
async function loadVisibleFolder(
  id: string,
  role: Role,
): Promise<
  { ok: true; folder: NonNullable<Awaited<ReturnType<typeof getFolderById>>> } | { ok: false; response: NextResponse }
> {
  const folder = await getFolderById(id);
  if (folder === null || folder.deletedAt !== null) {
    return { ok: false, response: jsonError('not_found', 'Folder not found', 404) };
  }
  if (!canRoleSee(toVisibilityRule(folder.visibility, folder.allowedRoles), role)) {
    return { ok: false, response: jsonError('not_found', 'Folder not found', 404) };
  }
  return { ok: true, folder };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'folder.manage')) {
      return jsonError('forbidden', 'Editing folders requires editor role', 403);
    }

    const { id } = await params;
    const loaded = await loadVisibleFolder(id, user.role);
    if (!loaded.ok) return loaded.response;
    const { folder } = loaded;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: { displayName?: string; visibility?: 'all' | 'restricted'; allowedRoles?: Role[] } = {};

    if (body.displayName !== undefined) {
      const name = parseName(body.displayName);
      if (name === null) {
        return jsonError('bad_request', 'displayName must be a name without slashes (max 255)', 400);
      }
      patch.displayName = name;
    }

    if (body.visibility !== undefined) {
      const acl = parseAclInput(body.visibility, body.allowedRoles ?? []);
      if (typeof acl === 'string') return jsonError('bad_request', acl, 400);

      const current: AclInput = { visibility: folder.visibility, allowedRoles: folder.allowedRoles };
      if (requiresAdminToApply(current, acl) && !can(user.role, 'folder.viewRestricted')) {
        return jsonError('forbidden', 'Only admins can change restricted permissions', 403);
      }
      patch.visibility = acl.visibility;
      patch.allowedRoles = [...acl.allowedRoles];
    }

    if (Object.keys(patch).length === 0) {
      return jsonError('bad_request', 'No updatable fields provided', 400);
    }

    const updated = await updateFolder(id, patch);
    if (updated === null) return jsonError('not_found', 'Folder not found', 404);
    return NextResponse.json({ folder: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('folder_update_failed', message, 500);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'folder.delete')) {
      return jsonError('forbidden', 'Deleting folders requires admin', 403);
    }

    const { id } = await params;
    const loaded = await loadVisibleFolder(id, user.role);
    if (!loaded.ok) return loaded.response;

    const callerId = await getUserIdByLogtoId(user.userId).catch(() => null);
    const result = await softDeleteFolderCascade(loaded.folder, callerId, randomUUID());

    return NextResponse.json({
      ok: true,
      batchId: result.batchId,
      folderCount: result.folderIds.length,
      documentCount: result.documentIds.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('folder_delete_failed', message, 500);
  }
}
