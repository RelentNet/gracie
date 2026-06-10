import { NextResponse } from 'next/server';

import { handleSignIn } from '@logto/next/server-actions';

import { isLogtoConfigured, logtoConfig } from '@/lib/logto';

/**
 * Logto OAuth callback. Exchanges the authorization code, establishes the
 * session cookie, then redirects into the app (docs/07 §5). When Logto is not
 * configured it simply redirects so the route resolves during scaffold dev.
 *
 * TODO(auth): on first login, upsert the `users` row from the verified claims
 * (sub/email/name) — docs/01 §4 "first login: backend upserts users row".
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (isLogtoConfigured()) {
    await handleSignIn(logtoConfig, new URL(request.url).searchParams);
  }
  return NextResponse.redirect(new URL('/dashboard', request.url));
}
