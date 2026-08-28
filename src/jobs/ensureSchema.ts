// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Ensure booking schema
// DATE : 2026-08-26
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../config/database.js';
import { logger } from '../config/logger.js';

/** Schema path */
const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, '../../../database/sqlserver/booking_schema.sql');

/** Ensure booking schema */
export async function ensureBookingSchema(): Promise<void> {
  const raw = fs.readFileSync(schemaPath, 'utf8');
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--.*$/gm, '').trim().length > 0);
  const pool = await getPool();
  for (const batch of batches) {
    try {
      await pool.request().query(batch);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Booking schema batch skipped',
      );
    }
  }
  logger.info('BOOKING_SYSTEM_SCHEMA ready');
}
