import { getContext } from 'hono/context-storage';
import { deleteCookie, getCookie } from 'hono/cookie';

import { upsertUserFromLogto } from '@/lib/data/users';
import {
  baseUrl,
  handleSignInCallback,
  isLogtoConfigured,
  logtoConfig,
  signInFailedResponse,
} from '@/lib/logto';
import { RETURN_TO_COOKIE, safeReturnPath } from '@/lib/return-path';

/**
 * Logto OAuth callback. Exchanges the authorization code, establishes the
 * session cookie, upserts the `users` row from the verified claims on login
 * (docs/01 §4), then redirects into the app (docs/07 §5). When Logto is not
 * configured it simply redirects so the route resolves during scaffold dev.
 */
export async function GET(request: Request): Promise<Response> {
  const c = getContext();
  if (isLogtoConfigured()) {
    try {
      // The callback URL is rebuilt on the public origin: Logto checks it matches the
      // redirect URI it issued, and behind the proxy request.url is internal.
      const context = await handleSignInCallback(
        logtoConfig,
        `${baseUrl}/callback${new URL(request.url).search}`,
        { fetchUserInfo: true },
      );
      if (context.isAuthenticated) {
        await upsertUserFromLogto(context);
      }
    } catch (error) {
      deleteCookie(c, RETURN_TO_COOKIE, { path: '/' });
      return signInFailedResponse('callback', error);
    }
  }

  // Build the redirect from the app's known public origin, NOT request.url —
  // behind the Traefik/NPM proxy request.url is the internal http://localhost:3000,
  // which would bounce the browser to a dead localhost address after sign-in.
  // Back to the page the user was on when their session expired (set by /sign-in),
  // re-validated here; otherwise home.
  const returnTo = safeReturnPath(getCookie(c, RETURN_TO_COOKIE));
  deleteCookie(c, RETURN_TO_COOKIE, { path: '/' });
  return Response.redirect(new URL(returnTo ?? '/home', baseUrl), 307);
}
