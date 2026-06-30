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

import { getLogtoContext } from '@logto/next/server-actions';

import type { Role } from '@gracie/shared';

import { MOCK_USER } from './auth-shared';
import { isLogtoConfigured, logtoConfig, resolveRole } from './logto';

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
 */
export async function getRequestUser(): Promise<RequestUser> {
  if (!isLogtoConfigured()) return MOCK_REQUEST_USER;

  const context = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
  if (!context.isAuthenticated || !context.claims) {
    throw new Error('unauthorized');
  }
  return { userId: context.claims.sub, role: resolveRole(context) };
}

export function isAdmin(user: RequestUser): boolean {
  return user.role === 'admin';
}
