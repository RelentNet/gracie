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
  /**
   * The IDENTITY-PROVIDER subject (Logto `sub`) — NOT the `users.id` uuid that
   * database foreign keys point at. Use it for identity, never for ownership.
   */
  readonly id: string;
  /**
   * The internal `users.id` uuid, or null before the user's row exists (first-login
   * bootstrap) or if the lookup failed.
   *
   * Ownership comparisons MUST use this, not `id`. Columns like
   * `documents.uploaded_by_user_id` store the uuid, so comparing them against the
   * Logto subject silently never matches — the same confusion that produced a
   * production 500 in P9. Null means "ownership unknown", which callers should treat
   * as "not the owner" so the UI fails closed.
   */
  readonly internalId: string | null;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly role: Role;
  readonly isCalendarConnected: boolean;
  /**
   * The user's profile IANA timezone, or null when unset (falls back to
   * America/New_York). Used as the SSR/profile fallback for server-rendered
   * timestamps; the client UI otherwise renders in the device's local zone.
   * Auto-defaulted from the browser on first app load (see TimezoneAutoDefault).
   */
  readonly timezone: string | null;
}

/**
 * Dev-only role used when Logto is not configured. Switch to
 * 'admin' | 'standard' | 'viewer' to preview each role's UI locally.
 */
export const MOCK_ROLE: Role = 'admin';

/**
 * Mock identities, aligned to the seeded users so role-based ownership rules
 * (e.g. viewer "mark own task complete") behave correctly without Logto.
 *
 * `internalId` is the seeded `users.id` from `packages/db/seed/demo-cbg.ts` — the
 * uuid ownership checks compare against. Re-running that seed keeps these stable
 * (its ids are deterministic hashes), but changing a person's key there would
 * need the matching id updated here.
 */
export const MOCK_IDENTITIES: Readonly<Record<Role, AuthUser>> = {
  admin: {
    id: 'demo|terry',
    internalId: '249eb1cf-d1c7-5564-a5bb-6a8b1cdd4116',
    name: 'Terry Gilley',
    email: 'tgilley@cambridgebg.com',
    initials: 'TG',
    role: 'admin',
    isCalendarConnected: true,
    timezone: 'America/Chicago',
  },
  standard: {
    id: 'demo|marcus',
    internalId: '5ec1b114-4f5e-5256-ae7a-5159cd6e56df',
    name: 'Marcus Webb',
    email: 'mwebb@cambridgebg.com',
    initials: 'MW',
    role: 'standard',
    isCalendarConnected: true,
    timezone: 'America/Chicago',
  },
  viewer: {
    id: 'demo|nora',
    internalId: 'a072c861-c5f5-5928-8812-34165f5dcfaf',
    name: 'Nora Caldwell',
    email: 'ncaldwell@cambridgebg.com',
    initials: 'NC',
    role: 'viewer',
    isCalendarConnected: false,
    timezone: 'America/Chicago',
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
  internalId: null,
  name: 'Guest',
  email: '',
  initials: 'G',
  role: 'viewer',
  isCalendarConnected: false,
  timezone: null,
};

/** Two-letter initials from a display name (falls back to the email local part). */
export function deriveInitials(name: string, email: string): string {
  const source = (name.trim() || email.trim()).trim();
  if (source === '') return '?';
  const parts = source.split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  if (first !== '' && second !== '') return (first + second).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
