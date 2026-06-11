/**
 * The single shared ioredis connection for this worker process.
 *
 * Every `Queue` and `Worker` (and the /health PING) reuses this one connection.
 * `maxRetriesPerRequest: null` is REQUIRED by BullMQ — its blocking commands
 * (e.g. BRPOPLPUSH) must not be capped by ioredis's per-request retry limit.
 *
 * Lifecycle note: BullMQ internally duplicates this connection for its blocking
 * operations, but because we pass an EXISTING instance it will NOT close it on
 * `worker.close()`. The bootstrap owns this connection and quits it during
 * graceful shutdown.
 */
import { Redis } from 'ioredis';

/** Create the shared ioredis connection from a `REDIS_URL`. */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
}
