/**
 * User sync from Logto (docs/01 §4, docs/04 `users`).
 *
 * On every login the verified Logto identity is upserted into the `users` row
 * keyed by `logto_id` (refreshing email/name/initials/role + last-active).
 * Server-only; uses the service-role client. Calendar connection is NOT touched
 * here — it reflects MS access-group membership (docs/02 D5).
 */
import 'server-only';

import type { LogtoContext } from '@logto/next';

import { getServerClient } from '@gracie/db';

import { deriveInitials } from '../auth-shared';
import { resolveRole } from '../logto';

export async function upsertUserFromLogto(context: LogtoContext): Promise<void> {
  const { claims, userInfo } = context;
  if (!claims) return;

  const displayName = (userInfo?.name ?? claims.name) ?? '';
  const email = (userInfo?.email ?? claims.email) ?? '';
  if (email === '') {
    throw new Error(
      'Logto returned no email claim; cannot sync user (check the email scope / Entra mapping)',
    );
  }

  const db = getServerClient();
  const { error } = await db.from('users').upsert(
    {
      logto_id: claims.sub,
      email,
      name: displayName === '' ? email : displayName,
      initials: deriveInitials(displayName, email),
      role: resolveRole(context),
      last_active_at: new Date().toISOString(),
    },
    { onConflict: 'logto_id' },
  );
  if (error) throw new Error(`user upsert: ${error.message}`);
}
