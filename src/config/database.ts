// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : SQL Server pool for CLIENT_API_LIVE (all APIs)
// DATE : 2026-08-28
import sql from 'mssql';
import { env } from './env.js';
import { logger } from './logger.js';

let pool: sql.ConnectionPool | null = null;

/** Sql inputs */   
export type SqlInputs = Record<string, unknown>;
/** Db transaction */
export type DbTx = sql.Transaction;
/** Sql config */
export type SqlConfig = sql.config;

export function sqlConfig(): SqlConfig {
  return {
    server: env.DB_SERVER,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: {
      encrypt: Boolean(env.DB_ENCRYPT),
      trustServerCertificate: true,
      enableArithAbort: true,
      useUTC: false,
    },
    pool: { max: 20, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
  };
}

/** Is DB ready */
export function isDbReady(): boolean {
  return pool?.connected === true;
}

/** Bind request */
function bind(request: sql.Request, inputs?: SqlInputs): sql.Request {
  if (!inputs) return request;
  for (const [key, value] of Object.entries(inputs)) {
    if (value === undefined) continue;
    if (value === null) {
      request.input(key, sql.NVarChar, null);
      continue;
    }
    if (typeof value === 'boolean') {
      request.input(key, sql.Bit, value);
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) request.input(key, sql.Int, value);
      else request.input(key, sql.Float, value);
      continue;
    }
    if (value instanceof Date) {
      request.input(key, sql.DateTime, value);
      continue;
    }
    request.input(key, sql.NVarChar(sql.MAX), String(value));
  }
  return request;
}

/** Get pool */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool(sqlConfig()).connect();
  logger.info({ server: env.DB_SERVER, port: env.DB_PORT, db: env.DB_NAME }, 'SQL Server connected');
  try {
    const { ensureBookingSchema } = await import('../jobs/ensureSchema.js');
    await ensureBookingSchema();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Could not create booking tables on CLIENT_API_LIVE (need CREATE TABLE). Login still uses dbo.users.',
    );
  }
  return pool;
}

/** Ping DB */
export async function pingDb(): Promise<boolean> {
  try {
    const p = await getPool();
    await p.request().query('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** Close pool */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/** Run */
async function run<T>(target: sql.ConnectionPool | sql.Transaction, text: string, inputs?: SqlInputs): Promise<T[]> {
  const request = target instanceof sql.Transaction ? new sql.Request(target) : target.request();
  bind(request, inputs);
  const result = await request.query(text);
  const rows = (result.recordset ?? []) as T[];
  return rows;
}

/** Missing booking table */
export function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Invalid object name/i.test(message);
}

/** Object name */
export function missingObjectName(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/Invalid object name '([^']+)'/i);
  return match?.[1] ?? null;
}

/** Query */
export async function query<T>(text: string, inputs?: SqlInputs): Promise<T[]> {
  const p = await getPool();
  return run<T>(p, text, inputs);
}

/** Query returning [] when booking tables are not installed yet */
export async function querySoft<T>(text: string, inputs?: SqlInputs): Promise<T[]> {
  try {
    return await query<T>(text, inputs);
  } catch (err) {
    if (isMissingTableError(err)) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Booking table missing on CLIENT_API_LIVE — returning empty rows',
      );
      return [];
    }
    throw err;
  }
}

/** Query one */
export async function queryOne<T>(text: string, inputs?: SqlInputs): Promise<T | null> {
  const rows = await query<T>(text, inputs);
  return rows[0] ?? null;
}

/** Query one or null when booking tables are missing */
export async function queryOneSoft<T>(text: string, inputs?: SqlInputs): Promise<T | null> {
  const rows = await querySoft<T>(text, inputs);
  return rows[0] ?? null;
}

/** Exec */
export async function exec(text: string, inputs?: SqlInputs): Promise<{ rowsAffected: number }> {
  const p = await getPool();
  const request = bind(p.request(), inputs);
  const result = await request.query(text);
  const affected = Array.isArray(result.rowsAffected) ? result.rowsAffected[0] ?? 0 : 0;
  return { rowsAffected: affected };
}

/** With inserted id */
function withInsertedId(text: string): string {
  const sqlText = text.trim().replace(/;?\s*$/, '');
  if (/OUTPUT\s+INSERTED/i.test(sqlText)) return sqlText;
  return sqlText.replace(/\)(\s*)VALUES/i, ') OUTPUT INSERTED.Id$1VALUES');
}

/** Insert */
export async function insert(text: string, inputs?: SqlInputs): Promise<string> {
  const rows = await query<{ Id: string | number }>(withInsertedId(text), inputs);
  return String(rows[0]?.Id ?? '');
}

/** Tx query */
export async function txQuery<T>(tx: DbTx, text: string, inputs?: SqlInputs): Promise<T[]> {
  return run<T>(tx, text, inputs);
}

/** Tx insert */
export async function txInsert(tx: DbTx, text: string, inputs?: SqlInputs): Promise<string> {
  const rows = await run<{ Id: string | number }>(tx, withInsertedId(text), inputs);
  return String(rows[0]?.Id ?? '');
}

/** Tx query one */
export async function txQueryOne<T>(tx: DbTx, text: string, inputs?: SqlInputs): Promise<T | null> {
  const rows = await txQuery<T>(tx, text, inputs);
  return rows[0] ?? null;
}

/** With transaction */
export async function withTransaction<T>(
  fn: (tx: DbTx) => Promise<T>,
  isolation: 'READ COMMITTED' | 'SERIALIZABLE' | number = 'READ COMMITTED',
): Promise<T> {
  const p = await getPool();
  const tx = p.transaction();
  const level =
    isolation === 'SERIALIZABLE' || isolation === sql.ISOLATION_LEVEL.SERIALIZABLE
      ? sql.ISOLATION_LEVEL.SERIALIZABLE
      : sql.ISOLATION_LEVEL.READ_COMMITTED;
  await tx.begin(level);
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already aborted */
    }
    throw err;
  }
}

/** Sql driver */
export const sqlDriver = sql;
export { sql };
/** Isolation */
export const ISOLATION: { SERIALIZABLE: 'SERIALIZABLE'; READ_COMMITTED: 'READ COMMITTED' } = {
  SERIALIZABLE: 'SERIALIZABLE' as const,
  READ_COMMITTED: 'READ COMMITTED' as const,
} as const;
