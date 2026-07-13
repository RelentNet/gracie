/**
 * API-route auth helper.
 *
 * Resolves the requesting user's role for permission gating in API routes. When
 * Logto is configured it verifies the session (getLogtoContext) and reads the
 * role from the `user_role`/`app_role` claim (docs/07 §5, docs/02 D4). Until the
 * Logto app exists (admin first-run) the bootstrap secrets are unset and this
 * falls back to a mock admin so local development keeps working. The contract —
 * `getRequestUser()` resolving to `{ userId, role }` — is unchanged; it is now
 * async (session reads cannot be synchronous).
 */
import 'server-only';

import type { Role } from '@gracie/shared';

import { MOCK_USER } from './auth-shared';
import { getRoleByLogtoId } from './data/users';
import { isLogtoConfigured, logtoConfig, resolveRole, safeGetLogtoContext } from './logto';

export interface RequestUser {
  readonly userId: string;
  readonly role: Role;
}

// Fallback identity for local dev before Logto is wired. Derived from the SAME
// MOCK_ROLE/MOCK_IDENTITIES as the client AuthProvider (lib/auth-shared.ts), so
// flipping `MOCK_ROLE` to 'admin' | 'standard' | 'viewer' switches BOTH the UI
// and these API routes in lockstep — which is how the P6 transcript role filter
// is exercised locally. Replaced by real claims once the Logto secrets are set.
const MOCK_REQUEST_USER: RequestUser = {
  userId: MOCK_USER.id,
  role: MOCK_USER.role,
};

/**
 * Resolve the authenticated user for an API request. Throws when Logto is
 * configured but the request carries no valid session.
 *
 * Approach B: `users.role` is authoritative, so this reads the role from the DB
 * by `logto_id` — an admin's in-app role change takes effect here on the target's
 * next request. It falls back to the Logto claim when no `users` row exists yet
 * (first-login bootstrap) or the lookup fails (availability — identical to the
 * pre-B claim-only behaviour, so a DB blip never hard-fails auth).
 */
export async function getRequestUser(): Promise<RequestUser> {
  if (!isLogtoConfigured()) return MOCK_REQUEST_USER;

  // safeGetLogtoContext never throws — a stale/expired refresh token surfaces here
  // as a clean 'unauthorized' (→ 401) instead of a LogtoRequestError bubbling to 500.
  const context = await safeGetLogtoContext(logtoConfig, { fetchUserInfo: true });
  if (!context.isAuthenticated || !context.claims) {
    throw new Error('unauthorized');
  }
  const userId = context.claims.sub;

  let role: Role;
  try {
    role = (await getRoleByLogtoId(userId)) ?? resolveRole(context);
  } catch (dbError) {
    console.warn('getRequestUser: DB role lookup failed, using Logto claim role', dbError);
    role = resolveRole(context);
  }
  return { userId, role };
}

export function isAdmin(user: RequestUser): boolean {
  return user.role === 'admin';
}

/** Editor tier (admin + standard) — allowed to triage/create orgs from meetings. */
export function isEditor(user: RequestUser): boolean {
  return user.role === 'admin' || user.role === 'standard';
}
