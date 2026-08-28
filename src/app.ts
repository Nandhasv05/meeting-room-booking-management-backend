import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { env, isProd } from './config/env.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { router } from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { pingDb } from './config/database.js';

// Create and configure the Express application
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: isProd ? env.FRONTEND_URL : true, credentials: true }));
  //@ts-ignore
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(apiLimiter);

  app.get('/api/health', async (_req, res) => {
    const db = await pingDb();
    res.status(db ? 200 : 503).json({
      success: db,
      message: db ? 'Conference Hall API' : 'API is up but SQL Server is offline',
      data: {
        status: db ? 'ok' : 'degraded',
        database: db ? 'connected' : 'disconnected',
        dbServer: `${env.DB_SERVER}:${env.DB_PORT}`,
        dbName: env.DB_NAME,
      },
    });
  });

  app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));
  app.use('/api', router);
  app.use(notFound);
  app.use(errorHandler);

  if (isProd) {
    app.disable('x-powered-by');
  }

  return app;
}
