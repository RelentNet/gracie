/**
 * Boot check — verifies the worker starts WITHOUT Redis and exits cleanly.
 *
 * Used in CI/verification: builds the server, listens on an ephemeral port,
 * hits /health, then closes. Confirms the Phase 1A "starts without Redis"
 * constraint. Exit code 0 = pass.
 */
import { buildServer } from './index.js';

async function main(): Promise<void> {
  // Ensure no Redis is configured for this check.
  delete process.env.REDIS_URL;

  const app = buildServer();
  await app.listen({ port: 0, host: '127.0.0.1' });

  const response = await app.inject({ method: 'GET', url: '/health' });
  if (response.statusCode !== 200) {
    app.log.error(`Health check failed: ${response.statusCode}`);
    await app.close();
    process.exit(1);
  }

  app.log.info(`Boot check OK — worker started without Redis. /health: ${response.body}`);
  await app.close();
  process.exit(0);
}

void main();
