// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Authenticate
// DATE : 2026-08-26
import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import { directoryToAuth } from '../services/auth.service.js';
import { findDirectoryUserById } from '../services/clientApiUsers.js';
import { writeAudit } from './auditLogger.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { AuthUser } from '../types/index.js';

/** Authenticate */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Authentication required.', 401);
    }
    const token = header.slice(7);
    const claims = verifyAccessToken(token);
    const directory = await findDirectoryUserById(String(claims.sub));
    if (!directory?.isActive) {
      throw new AppError('Account is not active.', 401);
    }
    const auth: AuthUser = directoryToAuth(directory, {
      username: directory.userName,
    });
    req.user = auth;
    next();
  } catch (err) {
    if (err instanceof AppError) next(err);
    else next(new AppError('Invalid or expired session.', 401));
  }
}

/** Authorize */
export function authorize(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(new AppError('Authentication required.', 401));
      return;
    }
    if (required.length === 0) {
      next();
      return;
    }
    const ok = required.some((code) => user.permissions.includes(code));
    if (!ok) {
      void writeAudit({
        userId: user.id,
        action: AUDIT_ACTIONS.UNAUTHORIZED,
        module: 'auth',
        recordId: user.id,
        newValue: { required, path: req.originalUrl, method: req.method },
        req,
      });
      next(new AppError('You do not have permission to perform this action.', 403));
      return;
    }
    next();
  };
}

/** Optional auth */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  void authenticate(req, _res, next);
}
