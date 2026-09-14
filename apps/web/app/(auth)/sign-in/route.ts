import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { signIn } from '@logto/next/server-actions';

import { baseUrl, isLogtoConfigured, logtoConfig } from '@/lib/logto';
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
    return NextResponse.redirect(new URL('/home', request.url));
  }
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get('returnTo'));
  if (returnTo !== null) {
    (await cookies()).set(RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
  }
  await signIn(logtoConfig, { redirectUri: `${baseUrl}/callback` });
  // signIn() performs the redirect; this is unreachable but satisfies the type.
  return NextResponse.redirect(new URL('/login', request.url));
}
