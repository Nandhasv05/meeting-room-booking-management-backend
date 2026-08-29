// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Validate request
// DATE : 2026-08-26
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

function zodPayload(err: unknown) {
  if (!(err instanceof ZodError)) return { errors: err };
  const errors = err.issues.map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
  }));
  const first = errors[0];
  const message = first ? `${first.path}: ${first.message}` : 'Validation failed.';
  return { message, errors };
}

/** Validate request */
export function validateRequest(schema: {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) {
        const parsed = schema.query.parse(req.query);
        Object.assign(req.query, parsed);
      }
      if (schema.params) req.params = schema.params.parse(req.params) as typeof req.params;
      next();
    } catch (err) {
      const payload = zodPayload(err);
      next(new AppError(payload.message ?? 'Validation failed.', 422, payload));
    }
  };
}
