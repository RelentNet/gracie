/**
 * File-path authorization (server-only). Decides whether a role may obtain a
 * presigned URL for a given storage key, based on the owning folder's visibility in
 * the `folders` table (docs/01 §2, docs/02 §D14) and on whether the object has been
 * soft-deleted into the recycle bin.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import { canRoleSee, isUnderPath, toVisibilityRule, type Role } from '@gracie/shared';

export function canEditRole(role: Role): boolean {
  return role === 'admin' || role === 'standard';
}

/**
 * A key is accessible if it is not under a restricted folder the role may not see,
 * and neither it nor its folder is in the recycle bin.
 *
 * Folder match uses `isUnderPath` (segment boundary), not a bare `startsWith` — the
 * longest matching folder governs, and without the boundary a folder like
 * `…/transcripts` would also claim `…/transcripts-public/x` and answer for a subtree
 * it does not own. Keys under no known folder stay allowed: folders are the
 * restriction layer, so absence of a folder is absence of restriction.
 *
 * THE RECYCLE-BIN GATE LIVES HERE ON PURPOSE. This function is the choke point for
 * every presigned URL (`/api/files/url`) and both move endpoints, so denying deleted
 * keys here means a bin item cannot be fetched, moved, or overwritten by any path —
 * including with a URL minted moments before the delete. Restoring is the only way
 * back to the bytes.
 */
export async function canAccessKey(key: string, role: Role): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('folders')
    .select('path, visibility, allowed_roles, deleted_at');
  if (error) throw new Error(`canAccessKey: ${error.message}`);

  // The most specific folder whose path contains the key governs it.
  let governing: { visibility: string; allowed_roles: string[]; deleted_at: string | null } | null =
    null;
  let longest = -1;
  for (const f of data ?? []) {
    if (isUnderPath(key, f.path) && f.path.length > longest) {
      longest = f.path.length;
      governing = {
        visibility: f.visibility,
        allowed_roles: f.allowed_roles,
        deleted_at: f.deleted_at,
      };
    }
  }

  if (governing !== null) {
    if (governing.deleted_at !== null) return false;
    const rule = toVisibilityRule(
      governing.visibility as 'all' | 'restricted',
      governing.allowed_roles as Role[],
    );
    if (!canRoleSee(rule, role)) return false;
  }

  // The object's own document row may be deleted even when its folder is live.
  const doc = await db
    .from('documents')
    .select('deleted_at, visibility, allowed_roles')
    .eq('r2_key', key)
    .maybeSingle();
  if (doc.error !== null) throw new Error(`canAccessKey(document): ${doc.error.message}`);
  if (doc.data !== null) {
    if (doc.data.deleted_at !== null) return false;
    // A per-file override can only subtract — the folder check above already ran.
    const override = toVisibilityRule(doc.data.visibility, doc.data.allowed_roles);
    if (!canRoleSee(override, role)) return false;
  }

  return true;
}
