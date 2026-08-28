import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { getPool, closePool, isDbReady } from './config/database.js';
import { closeClientApiPool } from './config/clientApi.js';
import { attachSockets } from './sockets/index.js';
import { startScheduler } from './jobs/scheduler.js';
import { hydrateMailFromEnv } from './services/settings.service.js';

async function connectDbWithRetry(maxAttempts = 30, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await getPool();
      return true;
    } catch (err) {
      logger.warn(
        { attempt, maxAttempts, err: err instanceof Error ? err.message : err },
        `MySQL not ready (${env.DB_SERVER}:${env.DB_PORT}). Retrying…`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  attachSockets(server);

  const host = env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';
  server.listen(env.PORT, host, () => {
    logger.info({ host, port: env.PORT }, 'API listening');
    logger.info(
      `Open http://localhost:${env.PORT}/api/health — waiting for MySQL at ${env.DB_SERVER}:${env.DB_PORT}`,
    );
  });

  const ok = await connectDbWithRetry();
  if (!ok) {
    logger.error(
      {
        server: env.DB_SERVER,
        port: env.DB_PORT,
        tip: 'Start MAMP MySQL (port 8889) and confirm phpMyAdmin can connect.',
      },
      'API is up but database is offline. Login and APIs will fail until MySQL is available.',
    );
  } else {
    await hydrateMailFromEnv();
    startScheduler();
    logger.info({ ready: isDbReady() }, 'Database connected — scheduler started');
  }

  const shutdown = async () => {
    logger.info('Shutting down');
    server.close();
    await closePool();
    await closeClientApiPool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
