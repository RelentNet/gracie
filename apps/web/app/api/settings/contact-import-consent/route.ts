/**
 * Admin roster for the Outlook-contact-import allow-list (Settings → Contacts).
 *
 *   GET   → `{ mailboxes: string[], users: {id,name,email,initials}[] }`
 *           the current allow-list + every app user, so the panel can render a
 *           per-user toggle and surface any allowed mailbox not tied to a user.
 *   PATCH → `{ mailbox, allow }` flips one mailbox → `{ mailboxes }`.
 *
 * Admin only (a non-admin gets 403 on read AND write) — this controls whose
 * mailbox an admin may import.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser, isAdmin } from '@/lib/api-auth';
import { getConsentList, setConsent } from '@/lib/data/contact-import-consent';
import { getUserIdByLogtoId, listUsers } from '@/lib/data/users';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);
  try {
    const [mailboxes, allUsers] = await Promise.all([getConsentList(), listUsers()]);
    const users = allUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, initials: u.initials }));
    return NextResponse.json({ mailboxes, users });
  } catch (error) {
    return jsonError('consent_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await getRequestUser();
  } catch {
    return jsonError('unauthorized', 'Sign in required', 401);
  }
  if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mailbox = typeof body.mailbox === 'string' ? body.mailbox.trim() : '';
    if (mailbox === '' || !mailbox.includes('@')) {
      return jsonError('bad_request', 'A mailbox email address is required.', 400);
    }
    if (typeof body.allow !== 'boolean') {
      return jsonError('bad_request', 'allow must be a boolean.', 400);
    }
    const byUserId = await getUserIdByLogtoId(user.userId); // Logto id → internal uuid (null if unsynced)
    const mailboxes = await setConsent(mailbox, body.allow, byUserId);
    return NextResponse.json({ mailboxes });
  } catch (error) {
    return jsonError('consent_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
