// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Database configuration for the booking system
// DATE : 2026-08-26
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from './env.js';
import { logger } from './logger.js';

let pool: Pool | null = null;

export type SqlInputs = Record<string, unknown>;
export type DbTx = PoolConnection;

export function isDbReady(): boolean {
  return pool != null;
}

export function translateSql(sql: string): string {
  let s = sql;
  s = s.replace(/\bdbo\./g, '');
  s = s.replace(/SYSUTCDATETIME\(\)/gi, 'UTC_TIMESTAMP()');
  s = s.replace(/\bN'/g, "'");
  s = s.replace(/\[Key\]/g, '`Key`');
  s = s.replace(/\[Value\]/g, '`Value`');
  s = s.replace(/OFFSET\s+@Offset\s+ROWS\s+FETCH\s+NEXT\s+@PageSize\s+ROWS\s+ONLY/gi, 'LIMIT @Offset, @PageSize');
  s = s.replace(/OFFSET\s+(\d+)\s+ROWS\s+FETCH\s+NEXT\s+(\d+)\s+ROWS\s+ONLY/gi, 'LIMIT $1, $2');
  s = s.replace(/DATEDIFF\(MINUTE,\s*([^,]+),\s*([^)]+)\)/gi, 'TIMESTAMPDIFF(MINUTE, $1, $2)');
  s = s.replace(/DATEDIFF\(HOUR,\s*([^,]+),\s*([^)]+)\)/gi, 'TIMESTAMPDIFF(HOUR, $1, $2)');
  s = s.replace(/DATEADD\(MINUTE,\s*@Minutes,\s*UTC_TIMESTAMP\(\)\)/gi, 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL @Minutes MINUTE)');
  s = s.replace(/DATEADD\(DAY,\s*-30,\s*UTC_TIMESTAMP\(\)\)/gi, 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)');
  s = s.replace(/DATEPART\(HOUR,\s*([^)]+)\)/gi, 'HOUR($1)');
  s = s.replace(/CONVERT\(varchar\(8\),\s*([^,]+),\s*108\)/gi, "TIME_FORMAT($1, '%H:%i:%s')");
  s = s.replace(/CONVERT\(varchar\(10\),\s*CAST\(([^)]+) AS DATE\),\s*23\)/gi, "DATE_FORMAT($1, '%Y-%m-%d')");
  s = s.replace(/CONVERT\(varchar\(10\),\s*DATE\(([^)]+)\),\s*23\)/gi, "DATE_FORMAT($1, '%Y-%m-%d')");
  s = s.replace(/CAST\(([^()]+) AS DATE\)/gi, 'DATE($1)');
  s = s.replace(/CAST\(([^()]+) AS TIME\)/gi, 'TIME($1)');
  s = s.replace(/(\w+\.\w+|\w+)\s*\+\s*' '\s*\+\s*(\w+\.\w+|\w+)/g, "CONCAT($1, ' ', $2)");
  const top = s.match(/SELECT TOP\s+\(?(\d+)\)?\s+/i);
  if (top?.[1]) {
    s = s.replace(/SELECT TOP\s+\(?(\d+)\)?\s+/i, 'SELECT ');
    s = `${s.replace(/\s*;?\s*$/, '')} LIMIT ${top[1]}`;
  }
  s = s.replace(/@(\w+)/g, ':$1');
  return s;
}

function applyUtcSession(target: Pool): void {
  // mysql2 timezone 'Z' treats DATETIME as UTC. Align the MySQL session so
  // CURRENT_TIMESTAMP / NOW() match UTC_TIMESTAMP() and JS Date values.
  target.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
}

function poolOptions(includeDatabase: boolean): mysql.PoolOptions {
  return {
    host: env.DB_SERVER,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: includeDatabase ? env.DB_NAME : undefined,
    waitForConnections: true,
    connectionLimit: 20,
    namedPlaceholders: true,
    dateStrings: false,
    timezone: 'Z',
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        return field.string() === '1';
      }
      // BIGINT PKs/FKs as strings so /bookings/1 matches JSON Id: "1"
      if (field.type === 'LONGLONG') {
        const v = field.string();
        return v == null || v === '' ? null : v;
      }
      return next();
    },
  };
}

export async function getAdminPool(): Promise<Pool> {
  const created = mysql.createPool(poolOptions(false));
  applyUtcSession(created);
  return created;
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const created = mysql.createPool(poolOptions(true));
  applyUtcSession(created);
  try {
    const conn = await created.getConnection();
    try {
      await conn.query("SET time_zone = '+00:00'");
    } finally {
      conn.release();
    }
  } catch (err) {
    // Leave `pool` unset so the next call retries once MySQL is back up.
    await created.end().catch(() => undefined);
    throw err;
  }
  pool = created;
  logger.info({ server: env.DB_SERVER, port: env.DB_PORT, db: env.DB_NAME }, 'MySQL connected');
  return pool;
}

export async function pingDb(): Promise<boolean> {
  try {
    const p = await getPool();
    const conn = await p.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** mysql2's types omit the object form that `namedPlaceholders` accepts at runtime. */
type BoundValues = Parameters<Pool['query']>[1];

function normalizeInputs(inputs?: SqlInputs): SqlInputs | undefined {
  if (!inputs) return undefined;
  const out: SqlInputs = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

async function run<T>(
  target: Pool | PoolConnection,
  text: string,
  inputs?: SqlInputs,
): Promise<T[]> {
  const sql = translateSql(text);
  const params = normalizeInputs(inputs);
  const [rows] = await target.query<RowDataPacket[]>(sql, params as BoundValues);
  return rows as T[];
}

export async function query<T>(text: string, inputs?: SqlInputs): Promise<T[]> {
  const p = await getPool();
  return run<T>(p, text, inputs);
}

export async function queryOne<T>(text: string, inputs?: SqlInputs): Promise<T | null> {
  const rows = await query<T>(text, inputs);
  return rows[0] ?? null;
}

export async function exec(text: string, inputs?: SqlInputs): Promise<ResultSetHeader> {
  const p = await getPool();
  const sql = translateSql(text);
  const [result] = await p.query<ResultSetHeader>(sql, normalizeInputs(inputs) as BoundValues);
  return result;
}

/** Insert a row and return the AUTO_INCREMENT Id as a string. */
export async function insert(text: string, inputs?: SqlInputs): Promise<string> {
  const result = await exec(text, inputs);
  return String(result.insertId);
}

export async function txQuery<T>(tx: DbTx, text: string, inputs?: SqlInputs): Promise<T[]> {
  return run<T>(tx, text, inputs);
}

export async function txInsert(tx: DbTx, text: string, inputs?: SqlInputs): Promise<string> {
  const sql = translateSql(text);
  const [result] = await tx.query<ResultSetHeader>(sql, normalizeInputs(inputs) as BoundValues);
  return String(result.insertId);
}

export async function txQueryOne<T>(tx: DbTx, text: string, inputs?: SqlInputs): Promise<T | null> {
  const rows = await txQuery<T>(tx, text, inputs);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (tx: DbTx) => Promise<T>,
  isolation: 'READ COMMITTED' | 'SERIALIZABLE' = 'READ COMMITTED',
): Promise<T> {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* already aborted */
    }
    throw err;
  } finally {
    conn.release();
  }
}

export const sql = { ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' as const, READ_COMMITTED: 'READ COMMITTED' as const } };
