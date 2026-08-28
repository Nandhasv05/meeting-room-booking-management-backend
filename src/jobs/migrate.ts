// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Migrate booking system
// DATE : 2026-08-26
import { logger } from '../config/logger.js';
import { closePool, queryOne } from '../config/database.js';
import { ensureBookingSchema } from './ensureSchema.js';

/** Main */
async function main() {
  await ensureBookingSchema();
  const halls = await queryOne<{ Id: number | null }>(`SELECT OBJECT_ID(N'dbo.conference_halls', N'U') AS Id`);
  if (!halls?.Id) {
    logger.fatal(
      'CREATE TABLE is denied for client_api_user on CLIENT_API_LIVE. Run database/sqlserver/booking_schema.sql as db_owner, then grant_booking_tables.sql.',
    );
    await closePool();
    process.exit(1);
  }
  logger.info('BOOKING_SYSTEM_SCHEMA ready');
  await closePool();
}

/** Catch */
main().catch((err) => {
  logger.fatal({ err }, 'migration failed');
  process.exit(1);
});
