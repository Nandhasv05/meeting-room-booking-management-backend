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

/** AppError can fail instanceof across mixed dist/src copies — duck-type as well. */
function asAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (
    err &&
    typeof err === 'object' &&
    (err as { isOperational?: unknown }).isOperational === true &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number' &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return err as AppError;
  }
  return null;
}

/** Error handler */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const appErr = asAppError(err);
  if (appErr) {
    fail(res, appErr.message, appErr.statusCode, appErr.details);
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

  const raw = err instanceof Error ? err.message : '';
  if (/Violation of UNIQUE KEY constraint/i.test(raw)) {
    const value = raw.match(/duplicate key value is \(([^)]+)\)/i)?.[1];
    fail(res, value ? `That code is already in use (${value}).` : 'That code is already in use.', 409);
    return;
  }
  if (/String or binary data would be truncated/i.test(raw)) {
    fail(res, 'One of the fields is too long. Shorten the purpose, notes, or invite list.', 400);
    return;
  }
  if (/Conversion failed|Operand type clash|Invalid date/i.test(raw)) {
    fail(res, 'Booking could not be saved. Check the hall, department, and start/end times.', 400);
    return;
  }
  if (/permission was denied|is not allowed to/i.test(raw)) {
    fail(
      res,
      isProd
        ? 'Service temporarily unavailable. Please retry shortly.'
        : raw,
      503,
    );
    return;
  }
  if (/Invalid column name/i.test(raw)) {
    fail(
      res,
      isProd
        ? 'Booking catalog is out of date. Ask IT to apply booking_schema.sql.'
        : raw,
      503,
    );
    return;
  }

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
