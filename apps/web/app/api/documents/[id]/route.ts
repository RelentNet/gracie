/**
 * /api/documents/[id] — manage a single document.
 *
 *   PATCH  — rename (`fileName`) and/or set a per-file permission override
 *            (`visibility` + `allowedRoles`, or `visibility: null` to inherit again).
 *            Requires `folder.manage`; changing the restricted state requires admin.
 *   DELETE — move to the recycle bin. `file.deleteOwn` for your own upload,
 *            `file.deleteAny` (admin) for anyone's.
 *
 * VISIBILITY IS CHECKED BEFORE EXISTENCE IS ADMITTED: a document the caller may not
 * see returns 404, not 403, so these routes cannot be used to probe for the existence
 * of restricted content.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

import { can, canRoleSee, toVisibilityRule, type Role } from '@gracie/shared';

import { getRequestUser, type RequestUser } from '@/lib/api-auth';
import { getUserIdByLogtoId } from '@/lib/data/users';
import { getDocumentById, softDeleteDocument, updateDocument } from '@/lib/data/documents';
import { getFolderById } from '@/lib/data/folders';
import { parseAclInput, parseName, requiresAdminToApply, type AclInput } from '@/lib/documents-acl';

// @gracie/db (supabase-js) is Node-only.
export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Load a document the caller is allowed to act on, or an error response.
 * Enforces the folder ceiling + any per-file override before returning anything.
 */
async function loadVisibleDocument(
  id: string,
  role: Role,
): Promise<
  | { ok: true; document: Awaited<ReturnType<typeof getDocumentById>> & object; folderRule: AclInput | null }
  | { ok: false; response: NextResponse }
> {
  const document = await getDocumentById(id);
  if (document === null || document.deletedAt !== null) {
    return { ok: false, response: jsonError('not_found', 'Document not found', 404) };
  }

  let folderRule: AclInput | null = null;
  if (document.folderId !== null) {
    const folder = await getFolderById(document.folderId);
    if (folder !== null) {
      if (folder.deletedAt !== null) {
        return { ok: false, response: jsonError('not_found', 'Document not found', 404) };
      }
      folderRule = { visibility: folder.visibility, allowedRoles: folder.allowedRoles };
    }
  }

  const canSeeFolder = canRoleSee(
    folderRule === null ? null : toVisibilityRule(folderRule.visibility, folderRule.allowedRoles),
    role,
  );
  const canSeeDoc = canRoleSee(toVisibilityRule(document.visibility, document.allowedRoles), role);
  if (!canSeeFolder || !canSeeDoc) {
    return { ok: false, response: jsonError('not_found', 'Document not found', 404) };
  }
  return { ok: true, document, folderRule };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    if (!can(user.role, 'folder.manage')) {
      return jsonError('forbidden', 'Editing documents requires editor role', 403);
    }

    const { id } = await params;
    const loaded = await loadVisibleDocument(id, user.role);
    if (!loaded.ok) return loaded.response;
    const { document } = loaded;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: { fileName?: string; visibility?: 'all' | 'restricted' | null; allowedRoles?: Role[] | null } = {};

    if (body.fileName !== undefined) {
      const name = parseName(body.fileName);
      if (name === null) {
        return jsonError('bad_request', 'fileName must be a name without slashes (max 255)', 400);
      }
      patch.fileName = name;
    }

    if (body.visibility !== undefined) {
      if (body.visibility === null) {
        // Clear the override — the file goes back to inheriting its folder. Dropping
        // a restriction is itself a restricted-state change, so it needs admin.
        if (document.visibility === 'restricted' && !can(user.role, 'folder.viewRestricted')) {
          return jsonError('forbidden', 'Only admins can change restricted permissions', 403);
        }
        patch.visibility = null;
        patch.allowedRoles = null;
      } else {
        const acl = parseAclInput(body.visibility, body.allowedRoles ?? []);
        if (typeof acl === 'string') return jsonError('bad_request', acl, 400);

        const current: AclInput =
          document.visibility === null
            ? // No override yet → compare against what it currently inherits, so
              // "lock this file down inside an open folder" is correctly seen as a
              // restricted-state change and gated on admin.
              (loaded.folderRule ?? { visibility: 'all', allowedRoles: ['admin', 'standard', 'viewer'] })
            : { visibility: document.visibility, allowedRoles: document.allowedRoles ?? [] };

        if (requiresAdminToApply(current, acl) && !can(user.role, 'folder.viewRestricted')) {
          return jsonError('forbidden', 'Only admins can change restricted permissions', 403);
        }
        patch.visibility = acl.visibility;
        patch.allowedRoles = [...acl.allowedRoles];
      }
    }

    if (Object.keys(patch).length === 0) {
      return jsonError('bad_request', 'No updatable fields provided', 400);
    }

    const updated = await updateDocument(id, patch);
    if (updated === null) return jsonError('not_found', 'Document not found', 404);
    return NextResponse.json({ document: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('document_update_failed', message, 500);
  }
}

/**
 * Resolve the caller's INTERNAL users.id. `getRequestUser().userId` is the Logto
 * subject, not the uuid FKs point at — conflating the two shipped a 500 in P9.
 */
async function internalUserId(user: RequestUser): Promise<string | null> {
  try {
    return await getUserIdByLogtoId(user.userId);
  } catch {
    return null;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const { id } = await params;
    const loaded = await loadVisibleDocument(id, user.role);
    if (!loaded.ok) return loaded.response;
    const { document } = loaded;

    const callerId = await internalUserId(user);
    const ownsIt = callerId !== null && document.uploadedByUserId === callerId;
    const allowed = can(user.role, 'file.deleteAny') || (ownsIt && can(user.role, 'file.deleteOwn'));
    if (!allowed) {
      return jsonError(
        'forbidden',
        ownsIt ? 'Deleting files requires editor role' : 'You can only delete files you uploaded',
        403,
      );
    }

    const deleted = await softDeleteDocument(id, callerId, randomUUID());
    if (deleted === null) return jsonError('not_found', 'Document not found', 404);
    return NextResponse.json({ ok: true, document: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError('document_delete_failed', message, 500);
  }
}
