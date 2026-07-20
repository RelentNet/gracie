/**
 * Effective folder/document visibility — the single source of truth for "may this
 * role see this thing?", shared by the API (enforcement) and the browser (mirror).
 *
 * WHY THIS EXISTS. `folders.allowed_roles` has been in the schema since day one but
 * was dead code: three separate call sites each collapsed it to "restricted ⇒ admin
 * only" by testing the array for `'admin'` and nothing else, so a folder marked
 * `allowed_roles = {admin,standard}` was still hidden from `standard`. Those three
 * implementations could also drift from each other. This module replaces all of them.
 *
 * TWO RULES worth stating explicitly, because both are load-bearing:
 *
 *  1. A folder is a CEILING for the files inside it. A per-file override can lock a
 *     file DOWN inside an open folder, but can never open a file UP inside a folder
 *     the role cannot see — otherwise an override would be a way to leak a document
 *     out of a restricted folder.
 *
 *  2. Admins always see restricted content (`folder.viewRestricted`). You cannot lock
 *     an admin out, so a permission editor must never present that as an option.
 */
import { can } from '../constants/permissions.js';
import type { FolderVisibility } from '../constants/enums.js';
import type { Role } from '../constants/roles.js';

/**
 * The permission-bearing shape of a folder, or of a document that overrides its
 * folder. Deliberately minimal so both raw DB rows and mapped domain objects can be
 * adapted onto it without importing either.
 */
export interface VisibilityRule {
  readonly visibility: FolderVisibility;
  readonly allowedRoles: readonly Role[];
}

/**
 * Build a rule from a nullable column pair. Returns null when the object does not
 * express permissions of its own — for a document that means "inherit my folder".
 * A visibility with no roles is treated as expressed (and will deny non-admins).
 */
export function toVisibilityRule(
  visibility: FolderVisibility | null,
  allowedRoles: readonly Role[] | null,
): VisibilityRule | null {
  if (visibility === null) return null;
  return { visibility, allowedRoles: allowedRoles ?? [] };
}

/**
 * Core check. A null rule means "not governed by anything" and is visible — folders
 * are the restriction layer, so absence of a folder is absence of restriction (this
 * preserves the long-standing behaviour for ad-hoc generated paths).
 */
export function canRoleSee(rule: VisibilityRule | null, role: Role): boolean {
  if (rule === null) return true;
  if (rule.visibility !== 'restricted') return true;
  if (rule.allowedRoles.includes(role)) return true;
  // Admins always retain access to restricted content.
  return can(role, 'folder.viewRestricted');
}

/**
 * Document visibility = its folder's rule, then its own override if it has one.
 * Enforces rule 1 above: the folder is checked FIRST and can only ever subtract.
 */
export function canRoleSeeDocument(
  folderRule: VisibilityRule | null,
  documentOverride: VisibilityRule | null,
  role: Role,
): boolean {
  if (!canRoleSee(folderRule, role)) return false;
  return canRoleSee(documentOverride, role);
}

/**
 * Path containment with a SEGMENT BOUNDARY.
 *
 * Everything that authorizes or cascades by folder path must go through this. A bare
 * `startsWith` (what `canAccessKey` and the tree builder used to do) treats
 * `clients/acme/transcripts` as a prefix of `clients/acme/transcripts-public/x`, so a
 * restricted folder could govern an unrelated sibling — and, worse, the
 * "longest matching folder wins" rule could select the WRONG folder entirely and hand
 * back the wrong verdict. Delete and permission changes both authorize through this,
 * so the boundary is what keeps them pointed at the right subtree.
 *
 * `path` itself counts as contained (a folder contains itself for cascade purposes).
 */
export function isUnderPath(candidate: string, path: string): boolean {
  return candidate === path || candidate.startsWith(`${path}/`);
}
