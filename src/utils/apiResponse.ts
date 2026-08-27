import type { Response } from 'express';

export function ok<T>(res: Response, data: T, message = 'OK', status = 200): void {
  res.status(status).json({ success: true, message, data });
}

export function created<T>(res: Response, data: T, message = 'Created'): void {
  ok(res, data, message, 201);
}

export function fail(res: Response, message: string, status = 400, data: unknown = null): void {
  res.status(status).json({ success: false, message, data });
}
