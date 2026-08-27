import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export type AccessClaims = {
  sub: string;
  email: string;
  role: string;
  typ: 'access';
};

export type RefreshClaims = {
  sub: string;
  typ: 'refresh';
  jti: string;
};

export function signAccessToken(userId: string, email: string, role: string): string {
  return jwt.sign({ sub: userId, email, role, typ: 'access' } satisfies AccessClaims, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES as SignOptions['expiresIn'],
  });
}

export function signRefreshToken(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, typ: 'refresh', jti } satisfies RefreshClaims, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, env.JWT_SECRET) as AccessClaims;
  if (payload.typ !== 'access') throw new Error('Invalid token type');
  return payload;
}

export function verifyRefreshToken(token: string): RefreshClaims {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshClaims;
  if (payload.typ !== 'refresh') throw new Error('Invalid token type');
  return payload;
}
