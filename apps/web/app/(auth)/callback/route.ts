import { NextResponse } from 'next/server';

import { getLogtoContext, handleSignIn } from '@logto/next/server-actions';

import { upsertUserFromLogto } from '@/lib/data/users';
import { baseUrl, isLogtoConfigured, logtoConfig } from '@/lib/logto';

/**
 * Logto OAuth callback. Exchanges the authorization code, establishes the
 * session cookie, upserts the `users` row from the verified claims on login
 * (docs/01 §4), then redirects into the app (docs/07 §5). When Logto is not
 * configured it simply redirects so the route resolves during scaffold dev.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (isLogtoConfigured()) {
    await handleSignIn(logtoConfig, new URL(request.url).searchParams);
    const context = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
    if (context.isAuthenticated) {
      await upsertUserFromLogto(context);
    }
  }
  // Build the redirect from the app's known public origin, NOT request.url —
  // behind the Traefik/NPM proxy request.url is the internal http://localhost:3000,
  // which would bounce the browser to a dead localhost address after sign-in.
  return NextResponse.redirect(new URL('/dashboard', baseUrl));
}
