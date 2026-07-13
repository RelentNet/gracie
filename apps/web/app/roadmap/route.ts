/**
 * GET /roadmap — serves the self-contained build-roadmap document as raw HTML,
 * gated to any signed-in staff member (docs/roadmap.html, maintained by the
 * `roadmap` skill).
 *
 * The payload is a COMPLETE `<!doctype html>` document with its own
 * `<head>`/`<style>`/`<svg>`, so it is returned verbatim — deliberately NOT
 * rendered through the app's React layout, which would strip/duplicate `<head>`
 * and break the inline SVG timeline. The markup is imported as a bundled string
 * (roadmap-html.generated.ts, produced by scripts/gen-roadmap.mjs) so it is
 * inlined into the Next server bundle at build time: no runtime dependency on
 * docs/ (excluded from the Docker context) or on the Next standalone file trace.
 *
 * Auth: reuses the app's Logto session check — the same `getLogtoContext` guard as
 * the authenticated app shell (app/(app)/layout.tsx). ANY authenticated role may
 * view; there is no special permission. A page visit with no session is REDIRECTED
 * into the sign-in flow (never a bare 401/500). When Logto is not configured (local
 * dev) the mock identity is treated as signed in, matching the rest of the app.
 */
import { NextResponse } from 'next/server';

import { baseUrl, isLogtoConfigured, logtoConfig, safeGetLogtoContext } from '@/lib/logto';

import { ROADMAP_HTML } from './roadmap-html.generated';

// getLogtoContext reads the session cookie, so this must never be statically
// rendered/cached; @logto/next server actions run on the Node.js runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (isLogtoConfigured()) {
    const { isAuthenticated } = await safeGetLogtoContext(logtoConfig);
    if (!isAuthenticated) {
      // Page visit → bounce into the sign-in flow (mirrors the app shell's
      // server-side guard), not a bare 401. Build the URL from the known public
      // origin: behind the Traefik/NPM proxy request.url is the internal
      // http://localhost:3000, which would dead-end the browser.
      return NextResponse.redirect(new URL('/login', baseUrl));
    }
  }

  return new NextResponse(ROADMAP_HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Reflects the roadmap as of the last web deploy; do not cache across deploys.
      'cache-control': 'no-store',
    },
  });
}
