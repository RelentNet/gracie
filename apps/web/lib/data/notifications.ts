/**
 * Notifications data layer (P7 §5). Every function is STRICTLY caller-scoped —
 * each query filters `.eq('user_id', userId)` — so a user can only ever read or
 * mutate their own notifications. Callers pass the resolved `users.id` from
 * {@link getSessionUser}, never a client-supplied id.
 *
 * Server-only; uses the service-role client (the authoritative permission gate is
 * the API layer + this per-user filter, docs/02 D14).
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Database } from '@gracie/db';

type NotificationType = Database['public']['Enums']['notification_type'];

/** A notification as shown in the bell/inbox. Never carries another user's rows. */
export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/** How many rows the bell fetches by default (most-recent first). */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** List the caller's notifications (most recent first). */
export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationItem[]> {
  const db = getServerClient();
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  let query = db
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (options.unreadOnly === true) query = query.is('read_at', null);

  const { data, error } = await query;
  if (error !== null) throw new Error(`list notifications: ${error.message}`);
  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

/** The caller's unread notification count. */
export async function getUnreadCount(userId: string): Promise<number> {
  const db = getServerClient();
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error !== null) throw new Error(`unread count: ${error.message}`);
  return count ?? 0;
}

/** Mark specific notifications (by id) read — scoped to the caller + only-if-unread. */
export async function markRead(userId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getServerClient();
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
    .in('id', [...ids]);
  if (error !== null) throw new Error(`mark read: ${error.message}`);
}

/** Mark ALL of the caller's unread notifications read. */
export async function markAllRead(userId: string): Promise<void> {
  const db = getServerClient();
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error !== null) throw new Error(`mark all read: ${error.message}`);
}
