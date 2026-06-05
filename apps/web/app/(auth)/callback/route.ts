import { NextResponse } from 'next/server';

/**
 * Logto OAuth callback handler — STUB (Phase 1A).
 *
 * Phase 1B TODO: exchange the authorization code with Logto, establish the
 * session cookie, sync/upsert the user row, then redirect into the app (docs/07
 * §5). For now it simply redirects to the dashboard so the route resolves.
 */
export function GET(request: Request): NextResponse {
  const url = new URL('/dashboard', request.url);
  return NextResponse.redirect(url);
}
