'use client';

/**
 * Auth context — MOCK (Phase 1A).
 *
 * ⚠️ Phase 1B: replace the mock user below with the real Logto session. The
 * provider will read the verified JWT (role/sub claims) instead of the constant
 * here; `useAuth`, `hasRole`, and `canEdit` keep the SAME signatures so call
 * sites do not change. See docs/07 §5 (Logto) and docs/02 D4.
 *
 * To demonstrate role-based UI filtering during scaffold review, change
 * `MOCK_ROLE` below to 'admin' | 'standard' | 'viewer' and observe the sidebar
 * (Settings hidden for non-admin), the Finance tab, and edit affordances react.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { can } from '@gracie/shared';
import type { Permission, Role } from '@gracie/shared';

// --- MOCK CONFIG (Phase 1B: delete) ----------------------------------------
/** Switch this to preview each role. Replaced by the real Logto claim later. */
const MOCK_ROLE: Role = 'admin';

/** The shape the UI consumes — a trimmed view of the `User` row. */
export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly role: Role;
  readonly isCalendarConnected: boolean;
}

// Mock identities aligned to lib/mock users so role-based ownership rules
// (e.g. viewer "mark own task complete") are testable before Phase 1B wires
// real Logto users. Each role maps to a real mock user that OWNS tasks.
const MOCK_IDENTITIES: Record<Role, AuthUser> = {
  admin: {
    id: 'usr_allie',
    name: 'Allie Grace',
    email: 'agrace@graceandassociates.com',
    initials: 'AG',
    role: 'admin',
    isCalendarConnected: true,
  },
  standard: {
    id: 'usr_sarah',
    name: 'Sarah Chen',
    email: 'schen@graceandassociates.com',
    initials: 'SC',
    role: 'standard',
    isCalendarConnected: true,
  },
  viewer: {
    id: 'usr_john',
    name: 'John Smith',
    email: 'jsmith@graceandassociates.com',
    initials: 'JS',
    role: 'viewer',
    isCalendarConnected: false,
  },
};

const MOCK_USER: AuthUser = MOCK_IDENTITIES[MOCK_ROLE];
// ---------------------------------------------------------------------------

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

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const value = useMemo<AuthContextValue>(() => {
    const user = MOCK_USER;
    return {
      user,
      hasRole: (...roles: readonly Role[]): boolean => roles.includes(user.role),
      can: (permission: Permission): boolean => can(user.role, permission),
      canEdit: (): boolean => user.role === 'admin' || user.role === 'standard',
    };
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
