/**
 * `pnpm dev` entry for the server. Vite owns :3000 in development and proxies the
 * server's paths to this process, so it listens on API_PORT (default 3002 — the worker has 3001) instead.
 * Set API_PORT in .env.local if 3002 is taken; vite.config.ts reads the same value.
 */
process.env.PORT = process.env.API_PORT ?? '3002';
await import('./index');
