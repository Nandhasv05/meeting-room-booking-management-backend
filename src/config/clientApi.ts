// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Same SQL Server pool as database.ts (CLIENT_API_LIVE)
// DATE : 2026-08-28
import { getPool, queryOne, isDbReady } from './database.js';
import { logger } from './logger.js';
import sql from 'mssql';

/** Is client API configured */
export function isClientApiConfigured(): boolean {
  return true;
}

/** Get client API pool */
export async function getClientApiPool() {
  return getPool();
}

/** Close client API pool */
export async function closeClientApiPool(): Promise<void> {
  /* shared SQL Server pool is closed by closePool() */
}

/** Get client API now */
export async function getClientApiNow(): Promise<Date> {
  try {
    const row = await queryOne<{ NowTime: Date }>(`SELECT GETDATE() AS NowTime`);
    const value = row?.NowTime;
    const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'GETDATE failed; using host clock',
    );
    return new Date();
  }
}

/** Export functions */
export { sql, isDbReady };
