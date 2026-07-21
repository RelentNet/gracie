/**
 * Shared request-shape validation for the Documents management routes (rename /
 * permissions / delete), so folders and files agree on what a permission edit means.
 *
 * WHO MAY GRANT WHAT. Editing permissions requires `folder.manage` (admin +
 * standard), but only an ADMIN may create or clear a `restricted` state. That mirrors
 * the rule already enforced when creating a folder (`POST /api/folders` rejects
 * `restricted` from non-admins) and closes the obvious escalation: a standard user
 * must not be able to open up a folder that was locked down, nor lock one down in a
 * way they could not then undo.
 *
 * ADMIN IS NON-REMOVABLE. `canRoleSee` grants admins `folder.viewRestricted`
 * regardless of the stored array, so an allowed-roles list that omits `admin` would be
 * a lie the UI tells the user. We normalize it in rather than silently disagreeing.
 */
import { ROLES, isRole, type Role } from '@gracie/shared';

export interface AclInput {
  readonly visibility: 'all' | 'restricted';
  readonly allowedRoles: readonly Role[];
}

/**
 * Validate an untrusted `{ visibility, allowedRoles }` pair. Returns the normalized
 * value, or a string describing the problem (the caller turns that into a 400).
 */
export function parseAclInput(
  visibility: unknown,
  allowedRoles: unknown,
): AclInput | string {
  if (visibility !== 'all' && visibility !== 'restricted') {
    return "visibility must be 'all' or 'restricted'";
  }
  if (!Array.isArray(allowedRoles) || allowedRoles.some((r) => !isRole(r))) {
    return `allowedRoles must be an array of ${ROLES.join(' | ')}`;
  }
  const roles = [...new Set(allowedRoles as Role[])];

  if (visibility === 'all') {
    // An open folder is open to everyone; storing a partial list here would be
    // meaningless (the resolver short-circuits before reading it) and misleading.
    return { visibility, allowedRoles: [...ROLES] };
  }
  if (!roles.includes('admin')) roles.push('admin');
  return { visibility, allowedRoles: roles };
}

/**
 * True when this change touches the restricted state and therefore needs admin.
 * Comparing against the CURRENT state means a standard user can still rename a
 * restricted folder, or re-save an unrestricted one, without tripping the gate.
 */
export function requiresAdminToApply(current: AclInput, next: AclInput): boolean {
  if (current.visibility !== next.visibility) return true;
  if (next.visibility !== 'restricted') return false;
  const a = [...current.allowedRoles].sort().join(',');
  const b = [...next.allowedRoles].sort().join(',');
  return a !== b;
}

/**
 * Validate a rename. Returns the trimmed name, or null if unusable.
 *
 * Display names are permissive by design — they are never a path segment or an
 * object key (rename is metadata-only), so punctuation and spaces are fine and
 * "Q3 Proposal — Final (v2).pdf" must survive. The only things rejected are control
 * characters and path separators, which have no business in a label and would make
 * the UI ambiguous about hierarchy.
 */
export function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 255) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(trimmed)) return null;
  return trimmed;
}
