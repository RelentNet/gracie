import { getContext } from 'hono/context-storage';
import { setCookie } from 'hono/cookie';

import {
  baseUrl,
  isLogtoConfigured,
  logtoConfig,
  signInFailedResponse,
  signInUrl,
} from '@/lib/logto';
import { RETURN_TO_COOKIE, safeReturnPath } from '@/lib/return-path';

/**
 * Initiates the Logto → Microsoft Entra sign-in (docs/07 §5). Redirects to the
 * Logto sign-in page; the user returns to /callback. When Logto is not yet
 * configured this resolves into the app so the scaffold stays navigable.
 *
 * `?returnTo=/path` (set by the session-expired dialog) is remembered in a short-lived
 * cookie so /callback can send the user back to the page they were on. The Logto
 * redirect URI must match exactly, so the path can't ride on it.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isLogtoConfigured()) {
    return Response.redirect(new URL('/home', request.url), 307);
  }

  const returnTo = safeReturnPath(new URL(request.url).searchParams.get('returnTo'));
  if (returnTo !== null) {
    setCookie(getContext(), RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
      sameSite: 'lax',
      secure: logtoConfig.cookieSecure,
      path: '/',
      maxAge: 600,
    });
  }

  try {
    return Response.redirect(await signInUrl(logtoConfig, `${baseUrl}/callback`), 307);
  } catch (error) {
    return signInFailedResponse('sign-in', error);
  }
}
