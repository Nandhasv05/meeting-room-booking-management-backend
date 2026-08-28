// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Validate request
// DATE : 2026-08-26
import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

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
      next(new AppError('Validation failed.', 422, err));
    }
  };
}
