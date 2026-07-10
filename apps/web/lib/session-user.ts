/**
 * Resolve the authenticated request to a real `users` row id (uuid) — the canonical
 * per-user ownership boundary for caller-scoped features (P7 notifications, and the
 * Assistant, which has its own `getAssistantUser` wrapper over the same idea).
 *
 * The ownership id is ALWAYS derived here from the verified session — never from a
 * client-supplied value — so a user can only ever read/mutate their own rows.
 *
 *  - Logto configured → look up `users` by `logto_id = claims.sub`.
 *  - Local dev (mock)  → the mock `userId` (e.g. `usr_allie`) is neither a uuid nor
 *    a stored `logto_id`, so resolve by the mock identity's email (flipping
 *    `MOCK_ROLE` switches the resolved DB user in lockstep).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Role } from '@gracie/shared';

import { getRequestUser } from './api-auth';
import { MOCK_IDENTITIES } from './auth-shared';
import { isLogtoConfigured } from './logto';

/** The resolved actor: a real `users.id` plus the request role. */
export interface SessionUser {
  readonly id: string;
  readonly role: Role;
}

/** Email of the mock identity whose id matches `userId` ('' if none). */
function mockEmailFor(userId: string): string {
  for (const identity of Object.values(MOCK_IDENTITIES)) {
    if (identity.id === userId) return identity.email;
  }
  return '';
}

/**
 * Resolve the current request to a {@link SessionUser}. Throws when the identity
 * cannot be matched to a `users` row (an unprovisioned account) so a route can
 * never fall back to an ambiguous owner.
 */
export async function getSessionUser(): Promise<SessionUser> {
  const request = await getRequestUser();
  const db = getServerClient();

  const query = db.from('users').select('id');
  const { data, error } = await (isLogtoConfigured()
    ? query.eq('logto_id', request.userId)
    : query.eq('email', mockEmailFor(request.userId))
  ).maybeSingle();

  if (error !== null) throw new Error(`resolve user: ${error.message}`);
  if (data === null) throw new Error('No matching user account for this request.');

  return { id: data.id, role: request.role };
}
