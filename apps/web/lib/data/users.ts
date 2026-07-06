/**
 * User sync + in-app administration (docs/01 §4, docs/04 `users`, D14 `users.manage`).
 *
 * Approach B — Gracie's DB owns the app role. `users.role` is AUTHORITATIVE:
 * `getRoleByLogtoId` is what the API gate (lib/api-auth) and the SSR identity
 * (lib/server-auth) read on every request, so an admin's in-app role change
 * takes effect on the target's next request with NO re-login. The Logto claim
 * seeds the role on FIRST login only (bootstrap); later logins never overwrite
 * it — see `upsertUserFromLogto`.
 *
 * Server-only; uses the service-role client (bypasses RLS — the authoritative
 * permission gate is the API layer, docs/02 D14).
 */
import 'server-only';

import type { LogtoContext } from '@logto/next';

import { getServerClient } from '@gracie/db';
import type { Role } from '@gracie/shared';

import { deriveInitials } from '../auth-shared';
import { resolveRole } from '../logto';

/** A user row as shown in Settings → Users. Never carries secrets. */
export interface UserListItem {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly role: Role;
  readonly calendarConnected: boolean;
  readonly deactivated: boolean;
  readonly lastActiveAt: string | null;
}

/**
 * A guard violation in user administration (last-admin lockout, unknown user).
 * Carries an API `code`/`status` so routes surface a clear, non-leaky message.
 */
export class UserAdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UserAdminError';
  }
}

/**
 * Sync the verified Logto identity into `users` on login. Refreshes
 * email/name/initials/last-active every time; writes `role` ONLY when the row is
 * first created (seeded from the Logto claim, honouring the first-admin
 * bootstrap). A returning user's in-app role (Approach B) is never clobbered.
 */
export async function upsertUserFromLogto(context: LogtoContext): Promise<void> {
  const { claims, userInfo } = context;
  if (!claims) return;

  const displayName = (userInfo?.name ?? claims.name) ?? '';
  const email = (userInfo?.email ?? claims.email) ?? '';
  if (email === '') {
    throw new Error(
      'Logto returned no email claim; cannot sync user (check the email scope / Entra mapping)',
    );
  }

  const name = displayName === '' ? email : displayName;
  const initials = deriveInitials(displayName, email);
  const db = getServerClient();

  // Insert-if-absent, seeding `role` from the claim (first-login bootstrap). On
  // conflict this does NOTHING (`ignoreDuplicates`) so an existing row's role —
  // which the admin may have changed in-app — is left untouched.
  const { error: insertError } = await db.from('users').upsert(
    {
      logto_id: claims.sub,
      email,
      name,
      initials,
      role: resolveRole(context),
      last_active_at: new Date().toISOString(),
    },
    { onConflict: 'logto_id', ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`user upsert: ${insertError.message}`);

  // Refresh identity + last-active for the (possibly pre-existing) row WITHOUT
  // touching `role`. A harmless no-op rewrite for a row we just inserted.
  const { error: updateError } = await db
    .from('users')
    .update({ email, name, initials, last_active_at: new Date().toISOString() })
    .eq('logto_id', claims.sub);
  if (updateError) throw new Error(`user sync: ${updateError.message}`);
}

/**
 * The authoritative app role for a Logto subject, or `null` when no `users` row
 * exists yet (first-login bootstrap window — callers fall back to the Logto
 * claim). Read by the API gate on every request (Approach B). Throws only on a
 * genuine query error, which callers treat as "fall back to the claim".
 */
export async function getRoleByLogtoId(logtoId: string): Promise<Role | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('users')
    .select('role')
    .eq('logto_id', logtoId)
    .maybeSingle();
  if (error) throw new Error(`role lookup: ${error.message}`);
  return data?.role ?? null;
}

/** The `users.id` (row PK) for a Logto subject, or `null` if not synced yet. */
export async function getUserIdByLogtoId(logtoId: string): Promise<string | null> {
  const db = getServerClient();
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('logto_id', logtoId)
    .maybeSingle();
  if (error) throw new Error(`user lookup: ${error.message}`);
  return data?.id ?? null;
}

/** Every user for Settings → Users, ordered by name. Admin-only surface. */
export async function listUsers(): Promise<UserListItem[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('users')
    .select('id, name, email, initials, role, calendar_connected, deactivated_at, last_active_at')
    .order('name', { ascending: true });
  if (error) throw new Error(`list users: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    initials: u.initials,
    role: u.role,
    calendarConnected: u.calendar_connected,
    deactivated: u.deactivated_at !== null,
    lastActiveAt: u.last_active_at,
  }));
}

/**
 * Count ACTIVE admins OTHER than `excludeUserId` — the anti-lockout invariant is
 * "at least one active admin must always remain". A demotion/deactivation of the
 * target is safe iff this is ≥ 1.
 */
async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  const db = getServerClient();
  const { count, error } = await db
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .is('deactivated_at', null)
    .neq('id', excludeUserId);
  if (error) throw new Error(`admin count: ${error.message}`);
  return count ?? 0;
}

/**
 * Change a user's app role (Approach B — effective on their next request). Blocks
 * demoting the LAST active admin so the workspace can never be locked out of
 * user management (§4). No-ops when the role is unchanged.
 */
export async function setUserRole(userId: string, role: Role): Promise<void> {
  const db = getServerClient();
  const { data: target, error } = await db
    .from('users')
    .select('id, role, deactivated_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`load user: ${error.message}`);
  if (target === null) throw new UserAdminError('not_found', 'User not found.', 404);
  if (target.role === role) return; // no-op

  const isActiveAdmin = target.role === 'admin' && target.deactivated_at === null;
  if (isActiveAdmin && role !== 'admin' && (await countOtherActiveAdmins(userId)) === 0) {
    throw new UserAdminError(
      'last_admin',
      'This is the last remaining admin — promote another user to admin before changing this role.',
      409,
    );
  }

  const { error: updateError } = await db.from('users').update({ role }).eq('id', userId);
  if (updateError) throw new Error(`set role: ${updateError.message}`);
}

/**
 * Offboard (deactivate) or reactivate a user by stamping/clearing
 * `deactivated_at`. Blocks deactivating the LAST active admin (§4). No-ops when
 * the user is already in the requested state.
 */
export async function setUserActive(userId: string, active: boolean): Promise<void> {
  const db = getServerClient();
  const { data: target, error } = await db
    .from('users')
    .select('id, role, deactivated_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`load user: ${error.message}`);
  if (target === null) throw new UserAdminError('not_found', 'User not found.', 404);

  const currentlyActive = target.deactivated_at === null;
  if (currentlyActive === active) return; // already in the requested state

  if (!active && target.role === 'admin' && (await countOtherActiveAdmins(userId)) === 0) {
    throw new UserAdminError(
      'last_admin',
      'This is the last remaining admin — promote another user to admin before deactivating this account.',
      409,
    );
  }

  const { error: updateError } = await db
    .from('users')
    .update({ deactivated_at: active ? null : new Date().toISOString() })
    .eq('id', userId);
  if (updateError) throw new Error(`set active: ${updateError.message}`);
}
