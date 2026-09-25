/**
 * Mounts every `app/**\/route.ts` on the Hono server, using the same folder
 * conventions Next.js did — so the route files, and where they live, are unchanged:
 *
 *   app/api/clients/[clientId]/route.ts  →  /api/clients/:clientId
 *   app/(auth)/sign-in/route.ts          →  /sign-in        (route groups vanish)
 *
 * Each exported HTTP-method function becomes a handler. It receives the request (with
 * `nextUrl`) and `{ params }` as a Promise, exactly the Next.js route-handler signature.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Context, Hono } from 'hono';

import { withNextUrl } from './next-compat';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Response | Promise<Response>;

/** A route file's path under `app/` → its URL pattern. */
export function routePath(relativeFile: string): string {
  const segments = relativeFile
    .split(/[\\/]/)
    .slice(0, -1) // drop `route.ts`
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) => {
      if (segment.startsWith('[...') && segment.endsWith(']'))
        return `:${segment.slice(4, -1)}{.+}`;
      if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`;
      return segment;
    });
  return `/${segments.join('/')}`;
}

/**
 * Registration order. Hono uses the first matching handler, so at the first segment
 * where two patterns differ, a static segment must come before a dynamic one —
 * otherwise `/documents/:id` would swallow `/documents/trash`. (Next.js resolves the
 * same way: static beats dynamic.)
 */
export function compareRoutes(a: string, b: string): number {
  const sa = a.split('/');
  const sb = b.split('/');
  for (let i = 0; i < Math.min(sa.length, sb.length); i += 1) {
    const dynamicA = sa[i]!.startsWith(':');
    const dynamicB = sb[i]!.startsWith(':');
    if (dynamicA !== dynamicB) return dynamicA ? 1 : -1;
    if (sa[i] !== sb[i]) return sa[i]! < sb[i]! ? -1 : 1;
  }
  return sa.length - sb.length;
}

/**
 * Adapt a Next-style route handler to Hono.
 *
 * The response is re-wrapped with `c.newResponse` because a Response returned as-is
 * would DROP any cookie set through the Hono context during the request — which is
 * exactly how the Logto session and the sign-in return path are written. Verified:
 * returned raw, the `Set-Cookie` header is missing; re-wrapped, it's there.
 */
export function toHonoHandler(handler: RouteHandler) {
  return async (c: Context): Promise<Response> => {
    const response = await handler(withNextUrl(c.req.raw), {
      params: Promise.resolve(c.req.param() as Record<string, string>),
    });
    return c.newResponse(response.body, response);
  };
}

/** Mount every route file under `appDir`. Returns the URL patterns mounted. */
export async function mountRoutes(app: Hono, appDir: string): Promise<string[]> {
  const files = readdirSync(appDir, { recursive: true, encoding: 'utf8' }).filter((file) =>
    /(^|[\\/])route\.ts$/.test(file),
  );
  const routes = files
    .map((file) => ({ file, pattern: routePath(file) }))
    .sort((a, b) => compareRoutes(a.pattern, b.pattern));

  const seen = new Map<string, string>();
  for (const { file, pattern } of routes) {
    const clash = seen.get(pattern);
    if (clash !== undefined)
      throw new Error(`Route clash: ${file} and ${clash} both map to ${pattern}`);
    seen.set(pattern, file);

    const mod = (await import(pathToFileURL(path.join(appDir, file)).href)) as Record<
      string,
      unknown
    >;
    const allowed: string[] = [];
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler !== 'function') continue;
      app.on(method, pattern, toHonoHandler(handler as RouteHandler));
      allowed.push(method);
    }
    // A path that exists but not for this method is a 405, as in Next.js. It must be
    // registered HERE, in precedence order: otherwise `PATCH /api/documents/trash`
    // (a GET-only route) would fall through to `/api/documents/:id` with id "trash".
    app.all(pattern, methodNotAllowed(allowed));
  }
  return routes.map((r) => r.pattern);
}

/** 405 with the `Allow` header listing what the path does accept. */
export function methodNotAllowed(allowed: readonly string[]) {
  return (): Response =>
    Response.json(
      { error: { code: 'method_not_allowed', message: 'Method not allowed' } },
      { status: 405, headers: { Allow: allowed.join(', ') } },
    );
}
