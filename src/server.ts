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
        `SQL Server not ready (${env.DB_SERVER}:${env.DB_PORT}/${env.DB_NAME}). Retrying…`,
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
      `Open http://localhost:${env.PORT}/api/health — waiting for SQL Server at ${env.DB_SERVER}:${env.DB_PORT}/${env.DB_NAME}`,
    );
  });

  const ok = await connectDbWithRetry();
  if (!ok) {
    logger.error(
      {
        server: env.DB_SERVER,
        port: env.DB_PORT,
        tip: 'Confirm SQL Server 192.168.9.19 CLIENT_API_LIVE is reachable with client_api_user.',
      },
      'API is up but SQL Server is offline. Login and APIs will fail until CLIENT_API_LIVE is available.',
    );
  } else {
    try {
      await hydrateMailFromEnv();
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'SMTP settings skipped (booking tables missing until a DBA runs booking_schema.sql)',
      );
    }
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
