// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Rate limiter
// DATE : 2026-08-26
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

function clientKey(req: Request): string {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ') && auth.length > 20) {
    return `tok:${auth.slice(7, 40)}`;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isHealth(req: Request): boolean {
  const path = req.path || '';
  return path === '/health' || path === '/api/health' || path.endsWith('/health');
}

/** Login limiter */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  validate: { xForwardedForHeader: false },
  message: { success: false, message: 'Too many login attempts. Try again later.', data: null },
});

/** API limiter — office NAT + Apache proxy share one IP, so do not key only on IP. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isHealth,
  keyGenerator: clientKey,
  validate: { xForwardedForHeader: false },
  message: { success: false, message: 'Rate limit exceeded.', data: null },
});
