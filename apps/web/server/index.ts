/**
 * The web server: the API (every `app/**\/route.ts`, see ./routes), Logto sign-in,
 * and — in production — the built single-page app from `dist/`.
 *
 * In development Vite serves the app on :3000 and proxies the server's paths here
 * (see vite.config.ts); run with `pnpm dev`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';

import { mountRoutes } from './routes';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(webDir, 'dist');

const app = new Hono();
// Lets code deep in lib/ (Logto session, getRequestUser) reach the current request's
// cookies without threading it through every call — as Next's `cookies()` did.
app.use(contextStorage());

const patterns = await mountRoutes(app, path.join(webDir, 'app'));

// An unknown API path is a JSON 404, never the app's HTML.
app.all('/api/*', (c) =>
  c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404),
);

const indexHtmlPath = path.join(distDir, 'index.html');
if (existsSync(indexHtmlPath)) {
  // Hashed build assets never change under the same name — cache them for good. The
  // HTML must be revalidated every time, or a tab could keep loading an old build's
  // chunk names after a deploy.
  app.use('*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/assets/')) {
      if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (c.res.headers.get('content-type')?.startsWith('text/html')) {
      c.header('Cache-Control', 'no-cache');
    }
  });
  app.use('*', serveStatic({ root: path.relative(process.cwd(), distDir) }));
  // A missing asset (e.g. an old chunk requested by a tab opened before a deploy) is
  // a 404 — never the app shell below, which the browser would try to run as script.
  app.get('/assets/*', (c) => c.notFound());
  // Every other path is a client-side route: serve the app shell.
  const indexHtml = readFileSync(indexHtmlPath, 'utf8');
  app.get('*', (c) => c.html(indexHtml));
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '0.0.0.0';
serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(
    `web server on http://${hostname}:${port} — ${patterns.length} routes` +
      (existsSync(indexHtmlPath) ? ', serving dist/' : ' (API only; UI via `vite`)'),
  );
});
