// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Rate limiter
// DATE : 2026-08-26
import rateLimit from 'express-rate-limit';

/** Login limiter */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again later.', data: null },
});

/** API limiter */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Rate limit exceeded.', data: null },
});
