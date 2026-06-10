import { NextResponse } from 'next/server';

import { signIn } from '@logto/next/server-actions';

import { baseUrl, isLogtoConfigured, logtoConfig } from '@/lib/logto';

/**
 * Initiates the Logto → Microsoft Entra sign-in (docs/07 §5). Redirects to the
 * Logto sign-in page; the user returns to /callback. When Logto is not yet
 * configured this resolves into the app so the scaffold stays navigable.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isLogtoConfigured()) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  await signIn(logtoConfig, { redirectUri: `${baseUrl}/callback` });
  // signIn() performs the redirect; this is unreachable but satisfies the type.
  return NextResponse.redirect(new URL('/login', request.url));
}
