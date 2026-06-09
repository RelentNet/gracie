/**
 * File-path authorization (server-only). Decides whether a role may obtain a
 * presigned URL for a given storage key, based on the owning folder's
 * visibility in the `folders` table (docs/01 §2, docs/02 §D14).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Role } from '@gracie/shared';

export function canEditRole(role: Role): boolean {
  return role === 'admin' || role === 'standard';
}

/**
 * A key is accessible if it is NOT under any restricted folder the role is not
 * allowed to see. We match the key against folder `path` prefixes; the longest
 * matching folder governs. Keys under no known folder are allowed (e.g. ad-hoc
 * generated paths) — folders are the restriction layer, absence = unrestricted.
 */
export async function canAccessKey(key: string, isAdmin: boolean): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('folders')
    .select('path, visibility, allowed_roles');
  if (error) throw new Error(`canAccessKey: ${error.message}`);

  // Find the most specific folder whose path is a prefix of the key.
  let governing: { visibility: string; allowed_roles: string[] } | null = null;
  let longest = -1;
  for (const f of data ?? []) {
    if (key.startsWith(f.path) && f.path.length > longest) {
      longest = f.path.length;
      governing = { visibility: f.visibility, allowed_roles: f.allowed_roles };
    }
  }

  if (governing === null) return true; // not under a managed folder
  if (governing.visibility !== 'restricted') return true;
  // restricted → admin only (mirrors folder visibility rules)
  return isAdmin && governing.allowed_roles.includes('admin');
}
