/**
 * Server-side resolution of the current user for UI hydration
 * (lib/auth.tsx AuthProvider, via the root layout). Server-only.
 */
import 'server-only';

import { getLogtoContext } from '@logto/next/server-actions';

import type { AuthUser } from './auth-shared';
import { GUEST_USER, MOCK_USER, deriveInitials } from './auth-shared';
import { getRoleByLogtoId } from './data/users';
import { isLogtoConfigured, logtoConfig, resolveRole } from './logto';

/**
 * Resolve the current user:
 * - Logto not configured → mock identity (local dev).
 * - Configured + authenticated → real identity from Logto claims/userInfo.
 * - Configured + unauthenticated → guest placeholder (app routes redirect to
 *   /login before this is consumed).
 */
export async function getCurrentUser(): Promise<AuthUser> {
  if (!isLogtoConfigured()) return MOCK_USER;

  const context = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
  if (!context.isAuthenticated || !context.claims) return GUEST_USER;

  const { claims, userInfo } = context;
  const displayName = (userInfo?.name ?? claims.name) ?? '';
  const email = (userInfo?.email ?? claims.email) ?? '';

  // Approach B: reflect the authoritative DB role so the UI (sidebar, badges,
  // Settings visibility) matches the API gate right after a role change. Fall
  // back to the claim on the bootstrap window / a transient DB error.
  const dbRole = await getRoleByLogtoId(claims.sub).catch(() => null);

  return {
    id: claims.sub,
    name: displayName === '' ? email : displayName,
    email,
    initials: deriveInitials(displayName, email),
    role: dbRole ?? resolveRole(context),
    // Calendar connection = membership in the MS access group (docs/02 D5),
    // not a Logto attribute — resolved in a later phase.
    isCalendarConnected: false,
  };
}
