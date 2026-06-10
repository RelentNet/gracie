import { NextResponse } from 'next/server';

import { signOut } from '@logto/next/server-actions';

import { baseUrl, isLogtoConfigured, logtoConfig } from '@/lib/logto';

/**
 * Signs the user out of Logto, clears the session, and returns to /login
 * (docs/07 §5). No-op redirect when Logto is not configured.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isLogtoConfigured()) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  await signOut(logtoConfig, baseUrl);
  // signOut() performs the redirect; this is unreachable but satisfies the type.
  return NextResponse.redirect(new URL('/login', request.url));
}
