/**
 * `next/server` for the API route handlers under `app/api`.
 *
 * Those handlers were written as Next.js route handlers and still import from
 * `next/server`; tsconfig `paths` points that specifier here. They use exactly two
 * things from it — `NextResponse` (a `Response` plus the static `json`/`redirect`) and
 * `NextRequest#nextUrl` — and both are web-standard underneath. So this provides them
 * on the standard classes rather than rewriting 110 files. The server hands every
 * handler a real `Request` with `nextUrl` attached (see {@link withNextUrl}).
 */

/** A `Request` with Next's `nextUrl` (the parsed request URL). */
export class NextRequest extends Request {
  get nextUrl(): URL {
    return new URL(this.url);
  }
}

/**
 * A `Response`. The statics MUST return real `NextResponse` instances: ~100 routes
 * tell a 401 apart from a user with `authed instanceof NextResponse` (see
 * `requireRequestUser`). A plain `Response` there would be taken for a user.
 */
export class NextResponse extends Response {
  static override json(body: unknown, init?: ResponseInit): NextResponse {
    const res = Response.json(body, init);
    return new NextResponse(res.body, res);
  }

  /** Next's default is 307 (the web standard's is 302). */
  static override redirect(url: string | URL, init: number | ResponseInit = 307): NextResponse {
    const status = typeof init === 'number' ? init : (init.status ?? 307);
    const headers = new Headers(typeof init === 'number' ? undefined : init.headers);
    headers.set('Location', String(url));
    return new NextResponse(null, { status, headers });
  }
}

/** Attach `nextUrl` to an incoming request (no copy — the body stays unread). */
export function withNextUrl(request: Request): NextRequest {
  if (!('nextUrl' in request)) {
    Object.defineProperty(request, 'nextUrl', {
      get: () => new URL(request.url),
    });
  }
  return request as NextRequest;
}
