/**
 * Support requests (in-app Support tab).
 *   GET  /api/support            → the caller's own requests
 *   GET  /api/support?scope=all  → every request (admin only — the Settings inbox)
 *   POST /api/support            → file a request { category, message, pageUrl?, appVersion?, browser?, screen? }
 *
 * Any signed-in role may file and read their own. The author is always the session
 * user; context fields are free text, length-capped, and only ever shown to admins.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isAdmin, requireRequestUser } from '@/lib/api-auth';
import {
  createSupportRequest,
  listAllSupportRequests,
  listMySupportRequests,
} from '@/lib/data/support';
import { getSessionUser } from '@/lib/session-user';
import { isSupportCategory, SUPPORT_MESSAGE_MAX } from '@/lib/support';

export const runtime = 'nodejs';

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Optional context string: trimmed, capped, or null. */
function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;
  try {
    if (request.nextUrl.searchParams.get('scope') === 'all') {
      if (!isAdmin(user)) return jsonError('forbidden', 'Admin only', 403);
      return NextResponse.json({ requests: await listAllSupportRequests() });
    }
    const me = await getSessionUser();
    return NextResponse.json({ requests: await listMySupportRequests(me.id) });
  } catch (error) {
    return jsonError('support_list_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) return jsonError('bad_request', 'Invalid JSON body', 400);
  if (!isSupportCategory(body.category)) return jsonError('bad_request', 'Pick what kind of help you need', 400);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message === '') return jsonError('bad_request', 'Tell us what happened', 400);
  if (message.length > SUPPORT_MESSAGE_MAX) {
    return jsonError('bad_request', `Please keep it under ${SUPPORT_MESSAGE_MAX} characters`, 400);
  }

  try {
    const me = await getSessionUser();
    const id = await createSupportRequest({
      userId: me.id,
      category: body.category,
      message,
      pageUrl: optionalText(body.pageUrl, 500),
      appVersion: optionalText(body.appVersion, 40),
      browser: optionalText(body.browser, 300),
      screen: optionalText(body.screen, 120),
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return jsonError('support_create_failed', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
