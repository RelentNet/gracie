/**
 * PURE, CLIENT-SAFE access policy for the company-aware Assistant (P6B.1).
 *
 * SECURITY-CRITICAL. This is the *pure* half of the assistant's single
 * access-control surface — the total, DB-free decisions for "what may a caller of
 * this role see." It has NO `server-only` import and NO runtime (value) imports —
 * only `import type`, which type-stripping erases — so the EXACT functions the
 * feature runs are also the ones the security verification harness exercises
 * (scripts/verify-company-access.ts) with no database and no build step.
 *
 * The DB-backed half lives in ./access.ts, which composes these with the shipped
 * gates it REUSES (`filterChunksForRole` for transcripts + the restricted-folder
 * `filterChunksByFolderVisibility`). These functions MIRROR the app's existing
 * authorities and MUST stay in lockstep with them:
 *   - {@link redactClientForCaller}  ⇄  lib/data/clients.ts `redactClientForRole`
 *   - {@link isFolderVisibleToRole}  ⇄  lib/data/documents.ts `isVisibleToRole`
 *     and the predicate inside lib/data/chat-retrieval.ts `filterChunksByFolderVisibility`.
 */
import type { Client, Role } from '@gracie/shared';

/**
 * The asking user reduced to what every gate needs. This is the ONLY identity the
 * gates read; it is fixed for a whole turn and is NEVER derived from retrieved
 * text or tool arguments (so a malicious document can't escalate the caller).
 */
export interface CompanyCaller {
  readonly userId: string;
  readonly role: Role;
  readonly isAdmin: boolean;
}

/** Build a caller from a resolved request identity. Admin is derived from role. */
export function toCompanyCaller(user: { readonly userId: string; readonly role: Role }): CompanyCaller {
  return { userId: user.userId, role: user.role, isAdmin: user.role === 'admin' };
}

/**
 * SECURITY-CRITICAL. Strip admin-only client financials for non-admins. Fee tier
 * and contract value are OMITTED (nulled), not merely hidden — mirroring
 * lib/data/clients.ts `redactClientForRole`. Admins get the row unchanged.
 */
export function redactClientForCaller(client: Client, caller: CompanyCaller): Client {
  if (caller.isAdmin) return client;
  return { ...client, feeTier: null, contractValue: null };
}

/** Minimal folder shape the visibility rule needs (a subset of `Folder`). */
export interface FolderVisibility {
  readonly visibility: 'all' | 'restricted';
  readonly allowedRoles: readonly Role[];
}

/**
 * SECURITY-CRITICAL. A folder is visible when the caller is an admin (admins
 * bypass folder gating, as the file browser + chat retrieval do), or it is
 * unrestricted, or it is restricted AND the caller's role is explicitly allowed.
 * Restricted folders (e.g. Transcripts, allowed_roles=['admin']) are therefore
 * never returned to a viewer/standard user. Mirrors lib/data/documents.ts
 * `isVisibleToRole` and the drop-predicate in `filterChunksByFolderVisibility`.
 */
export function isFolderVisibleToRole(folder: FolderVisibility, caller: CompanyCaller): boolean {
  if (caller.isAdmin) return true;
  if (folder.visibility !== 'restricted') return true;
  return folder.allowedRoles.includes(caller.role);
}
