/**
 * GET /api/auth/session — "is my sign-in still good?" probe for the browser's
 * SessionWatcher. 200 when the session is valid, 401 when it is missing or stale.
 *
 * Uses the SAME live Logto check as every action route (`getRequestUser`, which
 * refreshes the access token and fetches userinfo) — deliberately not the page
 * layout's cookie-only check, which is exactly what let a stale session keep
 * rendering pages while every action failed. It lives in a route handler because
 * only a route can persist a refreshed token cookie; refreshing from a Server
 * Component can't, and with rotating refresh tokens that would sign users out.
 */
import { NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await requireRequestUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store' } });
}
