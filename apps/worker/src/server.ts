/**
 * The worker's Fastify app:
 *   - GET /health      → 200 { status, redis } (does a real Redis PING)
 *   - /admin/queues    → Bull Board UI for inspecting queues/jobs
 *
 * SECURITY: Bull Board is mounted with NO authentication. In prod the worker is
 * internal-only — it is NOT exposed through the Cloudflare Tunnel (docs/01), so
 * /admin/queues is reachable solely on the internal Docker network. Do not expose
 * this port publicly. No auth is needed in dev.
 */
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { Queue } from 'bullmq';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

/** Path Bull Board is mounted at (internal-network-only in prod — see file header). */
export const BULL_BOARD_PATH = '/admin/queues';

/** Dependencies the Fastify app needs at build time. */
export interface ServerDeps {
  /** Shared connection — used for the /health PING. */
  readonly connection: Redis;
  /** Queues to surface in Bull Board. */
  readonly queues: readonly Queue[];
}

/** /health response shape. */
interface HealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly redis: 'ok' | 'down';
}

/** Build (but do not start) the worker's Fastify app. */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/health', async (): Promise<HealthResponse> => {
    let redis: HealthResponse['redis'] = 'down';
    try {
      const pong = await deps.connection.ping();
      redis = pong === 'PONG' ? 'ok' : 'down';
    } catch (error) {
      app.log.error(error, 'Redis PING failed');
    }
    return { status: redis === 'ok' ? 'ok' : 'degraded', redis };
  });

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: deps.queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });
  void app.register(serverAdapter.registerPlugin(), { prefix: BULL_BOARD_PATH });

  return app;
}
