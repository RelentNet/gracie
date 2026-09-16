/**
 * Support requests data layer. Server-only (service-role client; the table has RLS
 * on with no policies, so only this path can touch it). Callers pass the resolved
 * `users.id` from the session — never a client-supplied id.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';

import {
  isSupportCategory,
  type SupportCategory,
  type SupportRequestView,
  type SupportStatus,
} from '../support';

export interface NewSupportRequest {
  readonly userId: string;
  readonly category: SupportCategory;
  readonly message: string;
  readonly pageUrl: string | null;
  readonly appVersion: string | null;
  readonly browser: string | null;
  readonly screen: string | null;
}

type Row = {
  id: string;
  category: string;
  message: string;
  page_url: string | null;
  app_version: string | null;
  browser: string | null;
  screen: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  users?: { name: string | null } | null;
};

function toView(r: Row, withName: boolean): SupportRequestView {
  return {
    id: r.id,
    category: isSupportCategory(r.category) ? r.category : 'problem',
    message: r.message,
    pageUrl: r.page_url,
    appVersion: r.app_version,
    browser: r.browser,
    screen: r.screen,
    status: r.status === 'done' ? 'done' : 'open',
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    ...(withName ? { userName: r.users?.name ?? null } : {}),
  };
}

/**
 * Save a request and ping every active admin's bell (except the author). The bell
 * insert is best-effort: a failed notification never loses the request itself.
 */
export async function createSupportRequest(input: NewSupportRequest): Promise<string> {
  const db = getServerClient();
  const { data, error } = await db
    .from('support_requests')
    .insert({
      user_id: input.userId,
      category: input.category,
      message: input.message,
      page_url: input.pageUrl,
      app_version: input.appVersion,
      browser: input.browser,
      screen: input.screen,
    })
    .select('id')
    .single();
  if (error !== null) throw new Error(`create support request: ${error.message}`);

  try {
    const [{ data: author }, { data: admins }] = await Promise.all([
      db.from('users').select('name').eq('id', input.userId).maybeSingle(),
      db.from('users').select('id').eq('role', 'admin').is('deactivated_at', null),
    ]);
    const who = author?.name ?? 'Someone';
    const rows = (admins ?? [])
      .filter((a) => a.id !== input.userId)
      .map((a) => ({
        user_id: a.id,
        type: 'support_request' as const,
        title: `Support request from ${who}`,
        body: input.message.slice(0, 160),
        link: '/settings?tab=support',
      }));
    if (rows.length > 0) await db.from('notifications').insert(rows);
  } catch (notifyError) {
    console.warn('createSupportRequest: admin notification failed', notifyError);
  }
  return data.id;
}

/** The caller's own requests, newest first. */
export async function listMySupportRequests(userId: string, limit = 20): Promise<SupportRequestView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('support_requests')
    .select('id, category, message, page_url, app_version, browser, screen, status, created_at, resolved_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error !== null) throw new Error(`list my support requests: ${error.message}`);
  return (data ?? []).map((r) => toView(r, false));
}

/** Every request for the admin inbox: open first, then newest. */
export async function listAllSupportRequests(limit = 100): Promise<SupportRequestView[]> {
  const db = getServerClient();
  const { data, error } = await db
    .from('support_requests')
    .select(
      'id, category, message, page_url, app_version, browser, screen, status, created_at, resolved_at, users(name)',
    )
    .order('status', { ascending: false }) // 'open' sorts after 'done' alphabetically → descending puts open first
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error !== null) throw new Error(`list support requests: ${error.message}`);
  return (data ?? []).map((r) => toView(r as Row, true));
}

/** Admin: mark a request done / reopen it. Returns false when it doesn't exist. */
export async function setSupportRequestStatus(id: string, status: SupportStatus): Promise<boolean> {
  const db = getServerClient();
  const { data, error } = await db
    .from('support_requests')
    .update({ status, resolved_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id');
  if (error !== null) throw new Error(`update support request: ${error.message}`);
  return (data ?? []).length > 0;
}
