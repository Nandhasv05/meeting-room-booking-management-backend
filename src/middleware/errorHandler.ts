import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { fail } from '../utils/apiResponse.js';
import { logger } from '../config/logger.js';
import { env, isProd } from '../config/env.js';
import { isMissingTableError, missingObjectName } from '../config/database.js';

/** Driver/socket codes that mean "the database itself is unreachable", not a bad request. */
const DB_DOWN_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'ESOCKET',
  'ETIMEOUT',
]);

/** Error code */
function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Error handler */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    fail(res, err.message, err.statusCode, err.details);
    return;
  }

  logger.error({ err }, 'Unhandled error');

  if (isMissingTableError(err)) {
    const objectName = missingObjectName(err) ?? 'dbo.conference_halls';
    fail(
      res,
      `${objectName} is missing on CLIENT_API_LIVE. Run booking_schema.sql then grant_booking_tables.sql in SSMS as db_owner (does not drop dbo.users).`,
      503,
    );
    return;
  }

  const code = errorCode(err);
  if (code && DB_DOWN_CODES.has(code)) {
    fail(
      res,
      isProd
        ? 'Service temporarily unavailable. Please retry shortly.'
        : `Database is unreachable (${code}). Check SQL Server ${env.DB_SERVER}:${env.DB_PORT}/${env.DB_NAME}.`,
      503,
    );
    return;
  }

  /** AggregateError and some driver errors carry an empty message, which used to
   * surface as a blank 500 with no clue about the cause. */
  const raw = err instanceof Error ? err.message : '';
  const detail = raw || code || (err instanceof Error ? err.name : '') || 'Unknown error';
  fail(res, isProd ? 'An unexpected error occurred.' : detail, 500);
}

/** Not found */
export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('Resource not found.', 404));
}

/** Async handler */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}
