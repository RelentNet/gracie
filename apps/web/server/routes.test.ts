import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Hono } from 'hono';
import { contextStorage, getContext } from 'hono/context-storage';
import { setCookie } from 'hono/cookie';

import { NextResponse, type NextRequest } from './next-compat';
import { compareRoutes, mountRoutes, routePath, toHonoHandler } from './routes';

test('routePath: folders become the URL, as in Next.js', () => {
  assert.equal(routePath('api/clients/route.ts'), '/api/clients');
  assert.equal(
    routePath('api/clients/[clientId]/notes/[noteId]/route.ts'),
    '/api/clients/:clientId/notes/:noteId',
  );
  assert.equal(routePath('(auth)/sign-in/route.ts'), '/sign-in');
  assert.equal(routePath('roadmap/route.ts'), '/roadmap');
  assert.equal(routePath('api\\webhooks\\recall\\route.ts'), '/api/webhooks/recall'); // Windows separators
  assert.equal(routePath('api/files/[...key]/route.ts'), '/api/files/:key{.+}');
});

test('compareRoutes: a static segment is registered before a dynamic one', () => {
  const sorted = [
    '/api/documents/:id',
    '/api/documents/trash',
    '/api/documents/move',
    '/api/documents',
  ].sort(compareRoutes);
  assert.ok(sorted.indexOf('/api/documents/trash') < sorted.indexOf('/api/documents/:id'));
  assert.ok(sorted.indexOf('/api/documents/move') < sorted.indexOf('/api/documents/:id'));
});

test('compareRoutes: deeper static wins over a dynamic sibling at the same depth', () => {
  const sorted = ['/api/calendar/meetings/:id/orgs', '/api/calendar/:id'].sort(compareRoutes);
  assert.equal(sorted[0], '/api/calendar/meetings/:id/orgs');
});

test('NextResponse statics return NextResponse instances (routes use instanceof to spot a 401)', async () => {
  const unauthorized = NextResponse.json({ error: 'x' }, { status: 401 });
  assert.ok(unauthorized instanceof NextResponse);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('content-type'), 'application/json');
  assert.deepEqual(await unauthorized.json(), { error: 'x' });

  const redirect = NextResponse.redirect(new URL('http://app.test/login'));
  assert.ok(redirect instanceof NextResponse);
  assert.equal(redirect.status, 307); // Next's default, not the web standard's 302
  assert.equal(redirect.headers.get('location'), 'http://app.test/login');
});

function mount(handler: Parameters<typeof toHonoHandler>[0], pattern = '/api/things/:id'): Hono {
  const app = new Hono();
  app.use(contextStorage());
  app.all(pattern, toHonoHandler(handler));
  return app;
}

test('toHonoHandler: cookies set through the Hono context survive a returned Response', async () => {
  const app = mount(async () => {
    setCookie(getContext(), 'logto_app', 'session', { httpOnly: true, path: '/', sameSite: 'lax' });
    return Response.redirect('http://app.test/home', 307);
  });
  const res = await app.request('/api/things/1');
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'http://app.test/home');
  assert.match(res.headers.get('set-cookie') ?? '', /^logto_app=session;/);
});

test('toHonoHandler: route params arrive as a Promise, like Next.js', async () => {
  const app = mount(async (_req, { params }) => Response.json(await params));
  const res = await app.request('/api/things/abc-123');
  assert.deepEqual(await res.json(), { id: 'abc-123' });
});

test('toHonoHandler: handlers get nextUrl, an unread body, and their own status + headers', async () => {
  const app = mount(async (req) => {
    const { nextUrl } = req as NextRequest;
    const body = (await req.json()) as { n: number };
    return Response.json(
      { q: nextUrl.searchParams.get('q'), n: body.n },
      { status: 201, headers: { 'x-route': 'yes' } },
    );
  });
  const res = await app.request('/api/things/1?q=hello', {
    method: 'POST',
    body: JSON.stringify({ n: 7 }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('x-route'), 'yes');
  assert.deepEqual(await res.json(), { q: 'hello', n: 7 });
});

test('toHonoHandler: a streamed body passes through intact', async () => {
  const app = mount(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of ['a', 'b', 'c'])
              controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
      ),
  );
  const res = await app.request('/api/things/1');
  assert.equal(await res.text(), 'abc');
});

test('mountRoutes: a static route wins, and a wrong method is a 405 — never a fall-through', async () => {
  const appDir = mkdtempSync(path.join(tmpdir(), 'routes-'));
  try {
    const write = (rel: string, body: string): void => {
      mkdirSync(path.dirname(path.join(appDir, rel)), { recursive: true });
      writeFileSync(path.join(appDir, rel), body);
    };
    write(
      'api/documents/trash/route.ts',
      "export async function GET() { return Response.json({ route: 'trash' }); }",
    );
    write(
      'api/documents/[id]/route.ts',
      "export async function PATCH(_r: Request, { params }: { params: Promise<{ id: string }> }) { return Response.json({ route: 'id', ...(await params) }); }",
    );
    const app = new Hono();
    app.use(contextStorage());
    await mountRoutes(app, appDir);

    const get = await app.request('/api/documents/trash');
    assert.deepEqual(await get.json(), { route: 'trash' });

    // Next.js would 405 here; a naive router would run the :id handler with id "trash".
    const patchTrash = await app.request('/api/documents/trash', { method: 'PATCH' });
    assert.equal(patchTrash.status, 405);
    assert.equal(patchTrash.headers.get('allow'), 'GET');

    const patchId = await app.request('/api/documents/abc', { method: 'PATCH' });
    assert.deepEqual(await patchId.json(), { route: 'id', id: 'abc' });

    const deleteId = await app.request('/api/documents/abc', { method: 'DELETE' });
    assert.equal(deleteId.status, 405);
    assert.equal(deleteId.headers.get('allow'), 'PATCH');
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});
