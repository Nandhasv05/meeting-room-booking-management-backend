// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : SQL Server pool for CLIENT_API_LIVE (SP_GET_USERS)
// DATE : 2026-08-28
import sql from 'mssql';
import { env } from './env.js';
import { logger } from './logger.js';

let pool: sql.ConnectionPool | null = null;

export function isClientApiConfigured(): boolean {
  return Boolean(env.CLIENT_API_SERVER && env.CLIENT_API_DATABASE && env.CLIENT_API_USER);
}

export async function getClientApiPool(): Promise<sql.ConnectionPool> {
  if (!isClientApiConfigured()) {
    throw new Error('CLIENT_API SQL Server is not configured.');
  }
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool({
    server: env.CLIENT_API_SERVER,
    port: env.CLIENT_API_PORT,
    database: env.CLIENT_API_DATABASE,
    user: env.CLIENT_API_USER,
    password: env.CLIENT_API_PASSWORD,
    options: {
      encrypt: Boolean(env.CLIENT_API_ENCRYPT),
      trustServerCertificate: true,
      enableArithAbort: true,
      // CLIENT_API_LIVE DATETIME values (GETDATE, last_login_time) are server local (IST).
      useUTC: false,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 20_000,
  }).connect();
  logger.info(
    { server: env.CLIENT_API_SERVER, db: env.CLIENT_API_DATABASE },
    'CLIENT_API SQL Server connected',
  );
  return pool;
}

export async function closeClientApiPool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/** SQL Server local clock (GETDATE) as a JS Date. Falls back to the API host clock. */
export async function getClientApiNow(): Promise<Date> {
  if (!isClientApiConfigured()) return new Date();
  try {
    const p = await getClientApiPool();
    const result = await p.request().query('SELECT GETDATE() AS NowTime');
    const value = result.recordset?.[0]?.NowTime;
    const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'CLIENT_API GETDATE failed; using host clock',
    );
    return new Date();
  }
}

export { sql };
