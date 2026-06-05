/**
 * GA App worker — Fastify bootstrap (Phase 1A stub).
 *
 * Starts a Fastify server that logs and exposes a health endpoint. Registers an
 * (empty) BullMQ queue placeholder ONLY when REDIS_URL is present — the worker
 * must start cleanly with NO Redis available (Phase 1A constraint).
 *
 * Phase 1B TODO: register processors, repeatable jobs, Recall/Graph/Resend/R2
 * clients (docs/03 §4), and the Supabase service-role client (@gracie/db).
 */
import Fastify from 'fastify';

import { PIPELINE_QUEUE_NAME, createPipelineQueue } from './queues/pipeline.queue.js';

const PORT = Number(process.env.WORKER_PORT ?? 3001);
const HOST = process.env.WORKER_HOST ?? '0.0.0.0';

export function buildServer(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    return { status: 'ok', service: 'worker', phase: '1A-scaffold' };
  });

  // Queue registration is GUARDED: only when Redis is configured. In Phase 1A
  // REDIS_URL is unset, so we skip it entirely and the worker still boots.
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl !== undefined && redisUrl.length > 0) {
    app.log.info(`Redis configured — registering queue "${PIPELINE_QUEUE_NAME}" (Phase 1B).`);
    // Phase 1B: const pipelineQueue = createPipelineQueue(redisUrl);
    void createPipelineQueue;
  } else {
    app.log.info(
      `No REDIS_URL set — skipping queue registration. Queue "${PIPELINE_QUEUE_NAME}" wired in Phase 1B.`,
    );
  }

  return app;
}

async function start(): Promise<void> {
  const app = buildServer();
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

// Only auto-start when run directly (not when imported by the boot-check).
const isMainModule = process.argv[1]?.endsWith('index.ts') === true;
if (isMainModule) {
  void start();
}
