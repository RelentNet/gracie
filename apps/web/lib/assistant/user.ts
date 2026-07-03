/**
 * Resolve the authenticated request to a real `users` row id (a uuid).
 *
 * Assistant data is keyed to `assistant_chats.user_id uuid → users(id)`, which is
 * NOT nullable — so, unlike KB/document routes (that null out a non-uuid mock id
 * on a nullable FK), the Assistant MUST map the request identity to a genuine DB
 * user. This mapping IS the per-user privacy boundary: every Assistant route
 * derives its ownership id from here, never from a client-supplied value.
 *
 *  - Logto configured → look up `users` by `logto_id = claims.sub`.
 *  - Local dev (mock)  → the mock `userId` (e.g. `usr_allie`) is neither a uuid
 *    nor a stored `logto_id`, so resolve by the mock identity's email. Flipping
 *    `MOCK_ROLE` (lib/auth-shared) switches the resolved DB user in lockstep,
 *    which is how per-user isolation is exercised locally.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Role } from '@gracie/shared';

import { getRequestUser } from '../api-auth';
import { MOCK_IDENTITIES } from '../auth-shared';
import { isLogtoConfigured } from '../logto';

/** The Assistant's canonical actor: a real `users.id` plus the request role. */
export interface AssistantUser {
  /** `users.id` (uuid) — the owner id for all Assistant rows. */
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
 * Resolve the current request to an {@link AssistantUser}. Throws when the
 * identity cannot be matched to a `users` row (an unprovisioned account) so a
 * route can never fall back to an ambiguous owner.
 */
export async function getAssistantUser(): Promise<AssistantUser> {
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
