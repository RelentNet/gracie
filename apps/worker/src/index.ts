/**
 * GA App worker — entrypoint.
 *
 * Wires the shared Redis connection, the queue/worker infrastructure, the sample
 * heartbeat schedule, and the Fastify app (health + Bull Board), then installs
 * graceful shutdown on SIGINT/SIGTERM.
 *
 * Scope (worker foundation): a real Fastify + BullMQ service + one sample
 * heartbeat job. The P5 AI pipeline and the P4 calendar crons (calendar-scan +
 * bot-dispatch) extend the factory pattern in ./queues/factory.ts.
 */
import type { Queue, Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES } from '@gracie/shared';

import { loadEnv } from './lib/env.js';
import { createRedisConnection } from './lib/redis.js';
import { createBotDispatchProcessor } from './processors/bot-dispatch.processor.js';
import { createCalendarScanProcessor } from './processors/calendar-scan.processor.js';
import { createGenerateProcessor } from './processors/generate.processor.js';
import { createHeartbeatProcessor } from './processors/heartbeat.processor.js';
import { createIngestProcessor } from './processors/ingest.processor.js';
import { createKbIngestProcessor } from './processors/kb-ingest.processor.js';
import { createWatchdogProcessor } from './processors/watchdog.processor.js';
import { createBotDispatchQueue, scheduleBotDispatch } from './queues/bot-dispatch.queue.js';
import { createCalendarScanQueue, scheduleCalendarScan } from './queues/calendar-scan.queue.js';
import { createWorker } from './queues/factory.js';
import { createGenerateQueue } from './queues/generate.queue.js';
import { createHeartbeatQueue, scheduleHeartbeat } from './queues/heartbeat.queue.js';
import { createIngestQueue } from './queues/ingest.queue.js';
import { createKbIngestQueue } from './queues/kb-ingest.queue.js';
import { createWatchdogQueue, scheduleTranscriptWatchdog } from './queues/watchdog.queue.js';
import { buildServer } from './server.js';

/** Resources to release on shutdown. */
interface ShutdownDeps {
  readonly app: FastifyInstance;
  readonly connection: Redis;
  readonly queues: readonly Queue[];
  readonly workers: readonly Worker[];
}

/**
 * Install a one-shot graceful shutdown. Order matters: stop the HTTP server
 * (no new health/UI requests) → stop the workers (finish in-flight jobs) → close
 * the queues → quit the shared Redis connection. Guarded so a second signal is a
 * no-op while shutdown is already in progress.
 */
function installShutdown(deps: ShutdownDeps): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    deps.app.log.info(`${signal} received — shutting down gracefully`);
    try {
      await deps.app.close();
      await Promise.all(deps.workers.map((worker) => worker.close()));
      await Promise.all(deps.queues.map((queue) => queue.close()));
      await deps.connection.quit();
      deps.app.log.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      deps.app.log.error(error, 'error during shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }
}

async function start(): Promise<void> {
  const env = loadEnv();
  const connection = createRedisConnection(env.redisUrl);

  // Build the queues + Fastify app first so processors can log through app.log.
  const heartbeatQueue = createHeartbeatQueue(connection);
  const ingestQueue = createIngestQueue(connection);
  const kbIngestQueue = createKbIngestQueue(connection);
  const generateQueue = createGenerateQueue(connection);
  const watchdogQueue = createWatchdogQueue(connection);
  const calendarScanQueue = createCalendarScanQueue(connection);
  const botDispatchQueue = createBotDispatchQueue(connection);
  const app = buildServer({
    connection,
    queues: [
      heartbeatQueue,
      ingestQueue,
      kbIngestQueue,
      generateQueue,
      watchdogQueue,
      calendarScanQueue,
      botDispatchQueue,
    ],
  });

  connection.on('error', (error) => app.log.error({ err: error }, 'redis connection error'));
  connection.on('ready', () => app.log.info('redis connection ready'));

  const heartbeatWorker = createWorker(
    QUEUE_NAMES.heartbeat,
    createHeartbeatProcessor(app.log),
    connection,
  );
  heartbeatWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'heartbeat job failed');
  });

  // Ingest: manual-upload pipeline (extract → chunk → embed → pgvector, P5a).
  const ingestWorker = createWorker(
    QUEUE_NAMES.ingest,
    createIngestProcessor(app.log),
    connection,
  );
  ingestWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'ingest job failed');
  });

  // KB ingest: global reference-doc pipeline (extract → chunk → embed, P6).
  const kbIngestWorker = createWorker(
    QUEUE_NAMES.kbIngest,
    createKbIngestProcessor(app.log),
    connection,
  );
  kbIngestWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'kb-ingest job failed');
  });

  // Generate: meeting pipeline (transcript → 6 docs → tasks → notify, P5b).
  const generateWorker = createWorker(
    QUEUE_NAMES.generate,
    createGenerateProcessor(app.log),
    connection,
  );
  generateWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'generate job failed');
  });

  // Watchdog: flag meetings stuck awaiting a transcript past the SLA (P5b).
  const watchdogWorker = createWorker(
    QUEUE_NAMES.watchdog,
    createWatchdogProcessor(app.log),
    connection,
  );
  watchdogWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'watchdog job failed');
  });

  // Calendar scan: Graph calendarView → match client → dedup → upsert meetings (P4).
  const calendarScanWorker = createWorker(
    QUEUE_NAMES.calendarScan,
    createCalendarScanProcessor(app.log),
    connection,
  );
  calendarScanWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'calendar-scan job failed');
  });

  // Bot dispatch: dispatch one Recall bot per due, opted-in meeting (P4).
  const botDispatchWorker = createWorker(
    QUEUE_NAMES.botDispatch,
    createBotDispatchProcessor(app.log),
    connection,
  );
  botDispatchWorker.on('failed', (job, error) => {
    app.log.error({ jobId: job?.id, err: error }, 'bot-dispatch job failed');
  });

  await scheduleHeartbeat(heartbeatQueue);
  await scheduleTranscriptWatchdog(watchdogQueue);
  await scheduleCalendarScan(calendarScanQueue);
  await scheduleBotDispatch(botDispatchQueue);

  installShutdown({
    app,
    connection,
    queues: [
      heartbeatQueue,
      ingestQueue,
      kbIngestQueue,
      generateQueue,
      watchdogQueue,
      calendarScanQueue,
      botDispatchQueue,
    ],
    workers: [
      heartbeatWorker,
      ingestWorker,
      kbIngestWorker,
      generateWorker,
      watchdogWorker,
      calendarScanWorker,
      botDispatchWorker,
    ],
  });

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`worker listening on http://${env.host}:${env.port} — Bull Board at /admin/queues`);
}

start().catch((error: unknown) => {
  // Fastify's logger may not exist if start() failed before buildServer().
  console.error('worker failed to start:', error);
  process.exit(1);
});
