'use client';

/**
 * Auth context (client). Hydrated from the server-resolved identity passed as
 * `initialUser` (lib/server-auth.ts → root layout). Falls back to the mock user
 * when none is provided so client-only previews still render. `useAuth`,
 * `hasRole`, `can`, and `canEdit` keep stable signatures — call sites unchanged.
 * See docs/07 §5 (Logto) and docs/02 D4.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { can } from '@gracie/shared';
import type { Permission, Role } from '@gracie/shared';

import { MOCK_USER, type AuthUser } from './auth-shared';

export type { AuthUser };

export interface AuthContextValue {
  readonly user: AuthUser;
  /** True if the current user holds one of the given roles. */
  hasRole(...roles: readonly Role[]): boolean;
  /** True if the current user holds the given permission (D14 matrix). */
  can(permission: Permission): boolean;
  /** Convenience: editors (admin/standard) may mutate content. */
  canEdit(): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser = MOCK_USER,
}: {
  readonly children: ReactNode;
  readonly initialUser?: AuthUser;
}): React.JSX.Element {
  const value = useMemo<AuthContextValue>(() => {
    const user = initialUser;
    return {
      user,
      hasRole: (...roles: readonly Role[]): boolean => roles.includes(user.role),
      can: (permission: Permission): boolean => can(user.role, permission),
      canEdit: (): boolean => user.role === 'admin' || user.role === 'standard',
    };
  }, [initialUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
