/**
 * Self-serve Outlook-contact-import consent (My Settings). ANY logged-in user
 * flips their OWN opt-in. The mailbox is ALWAYS derived from the session
 * (`getRequestUser` → users.email) and any address in the body is IGNORED, so a
 * user can never opt anyone else in or out.
 *
 *   GET   → `{ allowed: boolean }` — is my mailbox on the allow-list?
 *   PATCH → `{ allow: boolean }` (also accepts `enabled` for the shared toggle) →
 *           `{ allowed }`. 404 when the session maps to no user profile (mock auth).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUser } from '@/lib/api-auth';
import { isConsented } from '@/lib/contact-import-consent';
import { getConsentList, setConsent } from '@/lib/data/contact-import-consent';
import { getEmailByLogtoId, getUserIdByLogtoId } from '@/lib/data/users';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const email = await getEmailByLogtoId(user.userId);
    if (email === null) return jsonError('no_profile', 'No user profile for the current session.', 404);
    return NextResponse.json({ allowed: isConsented(email, await getConsentList()) });
  } catch (error) {
    return jsonError('consent_read_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getRequestUser();
    const email = await getEmailByLogtoId(user.userId);
    if (email === null) return jsonError('no_profile', 'No user profile for the current session.', 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // `allow` is the documented field; `enabled` is what the shared SettingToggle
    // sends. Any `mailbox`/`email` in the body is deliberately never read.
    const raw = body.allow ?? body.enabled;
    if (typeof raw !== 'boolean') return jsonError('bad_request', 'allow must be a boolean.', 400);

    const byUserId = await getUserIdByLogtoId(user.userId); // Logto id → internal uuid for the stamp
    const mailboxes = await setConsent(email, raw, byUserId);
    return NextResponse.json({ allowed: isConsented(email, mailboxes) });
  } catch (error) {
    return jsonError('consent_write_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
