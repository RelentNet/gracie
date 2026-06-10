/**
 * Server-side resolution of the current user for UI hydration
 * (lib/auth.tsx AuthProvider, via the root layout). Server-only.
 */
import 'server-only';

import { getLogtoContext } from '@logto/next/server-actions';

import type { AuthUser } from './auth-shared';
import { GUEST_USER, MOCK_USER } from './auth-shared';
import { isLogtoConfigured, logtoConfig, resolveRole } from './logto';

function deriveInitials(name: string, email: string): string {
  const source = (name.trim() || email.trim()).trim();
  if (source === '') return '?';
  const parts = source.split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  if (first !== '' && second !== '') return (first + second).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

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

  return {
    id: claims.sub,
    name: displayName === '' ? email : displayName,
    email,
    initials: deriveInitials(displayName, email),
    role: resolveRole(context),
    // Calendar connection = membership in the MS access group (docs/02 D5),
    // not a Logto attribute — resolved in a later phase.
    isCalendarConnected: false,
  };
}
