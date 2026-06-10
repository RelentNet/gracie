/**
 * Shared auth identity types + mock identities.
 *
 * Imported by BOTH the client AuthProvider (lib/auth.tsx) and the server-side
 * resolver (lib/server-auth.ts), so this module must stay client-safe — no
 * `server-only`, no Node APIs. Real identities come from Logto once configured;
 * the mock identities drive local development until then (docs/02 D4).
 */
import type { Role } from '@gracie/shared';

/** The shape the UI consumes — a trimmed view of the `users` row. */
export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly role: Role;
  readonly isCalendarConnected: boolean;
}

/**
 * Dev-only role used when Logto is not configured. Switch to
 * 'admin' | 'standard' | 'viewer' to preview each role's UI locally.
 */
export const MOCK_ROLE: Role = 'admin';

/**
 * Mock identities aligned to the seeded users so role-based ownership rules
 * (e.g. viewer "mark own task complete") stay testable before real Logto users.
 */
export const MOCK_IDENTITIES: Readonly<Record<Role, AuthUser>> = {
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
} as const;

/** Identity used when Logto is not configured (local dev). */
export const MOCK_USER: AuthUser = MOCK_IDENTITIES[MOCK_ROLE];

/**
 * Least-privilege placeholder used when Logto IS configured but the request is
 * unauthenticated. App routes redirect to /login before this is consumed; it
 * exists only to keep `useAuth().user` non-null.
 */
export const GUEST_USER: AuthUser = {
  id: 'guest',
  name: 'Guest',
  email: '',
  initials: 'G',
  role: 'viewer',
  isCalendarConnected: false,
};
