import { baseUrl, isLogtoConfigured, logtoConfig, signOutUrl } from '@/lib/logto';

/**
 * Signs the user out of Logto, clears the session, and returns to /login
 * (docs/07 §5). No-op redirect when Logto is not configured.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isLogtoConfigured()) {
    return Response.redirect(new URL('/login', request.url), 307);
  }
  return Response.redirect(await signOutUrl(logtoConfig, baseUrl), 307);
}
