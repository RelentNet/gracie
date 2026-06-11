/**
 * Worker environment — read + validated from `process.env` (populated by the
 * `--env-file` flag in the dev/start scripts, or by the container runtime in
 * prod). Fails fast with a clear message when a required value is missing, so the
 * worker never boots into a half-configured state.
 */

/** Validated worker configuration. */
export interface WorkerEnv {
  /** BullMQ backing-store connection string (REQUIRED). */
  readonly redisUrl: string;
  /** Fastify bind port (default 3001 — avoids colliding with apps/web :3000). */
  readonly port: number;
  /** Fastify bind host (default 0.0.0.0). */
  readonly host: string;
}

/**
 * Read and validate the worker's environment. Throws if `REDIS_URL` is absent —
 * Redis is required infrastructure (D2), there is no in-process fallback.
 */
export function loadEnv(): WorkerEnv {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl === undefined || redisUrl.length === 0) {
    throw new Error(
      'REDIS_URL is not set. Create apps/worker/.env.local with the dev value from ' +
        'docs/SECRETS.md (Redis section), or set REDIS_URL in the environment.',
    );
  }

  const rawPort = process.env.WORKER_PORT;
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`WORKER_PORT must be a positive integer (got "${rawPort}").`);
  }

  const host = process.env.WORKER_HOST?.trim();

  return {
    redisUrl,
    port,
    host: host !== undefined && host.length > 0 ? host : '0.0.0.0',
  };
}
