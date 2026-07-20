/**
 * Server-side resolution of the current user for UI hydration
 * (lib/auth.tsx AuthProvider, via the root layout). Server-only.
 */
import 'server-only';

import type { AuthUser } from './auth-shared';
import { GUEST_USER, MOCK_USER, deriveInitials } from './auth-shared';
import { getRoleByLogtoId, getUserIdByLogtoId } from './data/users';
import { isLogtoConfigured, logtoConfig, resolveRole, safeGetLogtoContext } from './logto';

/**
 * Resolve the current user:
 * - Logto not configured → mock identity (local dev).
 * - Configured + authenticated → real identity from Logto claims/userInfo.
 * - Configured + unauthenticated → guest placeholder (app routes redirect to
 *   /login before this is consumed).
 */
export async function getCurrentUser(): Promise<AuthUser> {
  if (!isLogtoConfigured()) return MOCK_USER;

  // safeGetLogtoContext never throws — an unresolvable/expired session degrades to
  // the guest placeholder (the app-shell layout then redirects to /login) rather
  // than 500-ing every page via this root-layout call.
  const context = await safeGetLogtoContext(logtoConfig, { fetchUserInfo: true });
  if (!context.isAuthenticated || !context.claims) return GUEST_USER;

  const { claims, userInfo } = context;
  const displayName = (userInfo?.name ?? claims.name) ?? '';
  const email = (userInfo?.email ?? claims.email) ?? '';

  // Approach B: reflect the authoritative DB role so the UI (sidebar, badges,
  // Settings visibility) matches the API gate right after a role change. Fall
  // back to the claim on the bootstrap window / a transient DB error.
  // Resolved alongside the role (both are `users` lookups keyed by logto_id). The
  // uuid is what ownership checks compare against — see AuthUser.internalId.
  const [dbRole, internalId] = await Promise.all([
    getRoleByLogtoId(claims.sub).catch(() => null),
    getUserIdByLogtoId(claims.sub).catch(() => null),
  ]);

  return {
    id: claims.sub,
    internalId,
    name: displayName === '' ? email : displayName,
    email,
    initials: deriveInitials(displayName, email),
    role: dbRole ?? resolveRole(context),
    // Calendar connection = membership in the MS access group (docs/02 D5),
    // not a Logto attribute — resolved in a later phase.
    isCalendarConnected: false,
  };
}
