import { query, queryOne } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { hashToken, newId } from '../utils/ids.js';
import { writeAudit } from '../middleware/auditLogger.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import { accessForDirectoryUser } from '../config/access.js';
import {
  authenticateDirectory,
  findDirectoryUser,
  findDirectoryUserById,
  touchDirectoryLastLogin,
  type DirectoryUser,
} from './clientApiUsers.js';
import { verifyPortalTicket } from '../utils/portalSso.js';
import type { Request } from 'express';
import type { AuthUser } from '../types/index.js';

function splitName(value: string): { first: string; last: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || value || 'User', last: '' };
  return { first: parts[0] ?? 'User', last: parts.slice(1).join(' ') };
}

export function directoryToAuth(directory: DirectoryUser): AuthUser {
  const names = splitName(directory.userName);
  const access = accessForDirectoryUser({
    department: directory.department,
    role: directory.role,
    isAdmin: directory.isAdmin,
  });
  return {
    id: directory.id,
    email: directory.email,
    employeeId: directory.userName,
    firstName: names.first,
    lastName: names.last,
    roleId: access.roleId,
    roleCode: access.roleCode,
    roleName: access.roleName,
    departmentId: directory.department,
    departmentName: directory.department,
    permissions: access.permissions,
  };
}

const memorySessions = new Map<string, { userId: string; hash: string; expires: Date }>();

function rememberSession(userId: string, hash: string, expires: Date) {
  for (const [key, row] of memorySessions) {
    if (row.userId === userId) memorySessions.delete(key);
  }
  memorySessions.set(hash, { userId, hash, expires });
}

async function issueTokens(user: AuthUser) {
  const jti = newId();
  const refreshToken = signRefreshToken(user.id, jti);
  const accessToken = signAccessToken(user.id, user.email, user.roleCode);
  const refreshHash = hashToken(refreshToken);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await query(`DELETE FROM dbo.mh_sessions WHERE UserId = @Id`, { Id: user.id });
    await query(
      `INSERT INTO dbo.mh_sessions (UserId, RefreshTokenHash, ExpiresAt)
       VALUES (@Id, @Hash, @Exp)`,
      { Id: user.id, Hash: refreshHash, Exp: expires },
    );
  } catch {
    rememberSession(user.id, refreshHash, expires);
  }
  return { accessToken, refreshToken };
}

export async function login(email: string, password: string, req: Request) {
  const directory = await authenticateDirectory(String(email ?? '').trim(), String(password ?? ''));
  if (!directory) {
    throw new AppError('Invalid email or password.', 401);
  }
  if (!directory.isActive) {
    throw new AppError('Account is disabled.', 403);
  }
  const user = directoryToAuth(directory);
  const tokens = await issueTokens(user);
  await touchDirectoryLastLogin(user.id);
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.LOGIN,
    module: 'auth',
    recordId: user.id,
    req,
  });
  return { user, ...tokens };
}

export async function loginWithPortalSso(ticket: string, req: Request) {
  const login = verifyPortalTicket(ticket);
  const directory = await findDirectoryUser(login);
  if (!directory) {
    throw new AppError('Portal user was not found in the directory.', 401);
  }
  if (!directory.isActive) {
    throw new AppError('Account is disabled.', 403);
  }
  const user = directoryToAuth(directory);
  const tokens = await issueTokens(user);
  await touchDirectoryLastLogin(user.id);
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.LOGIN,
    module: 'auth',
    recordId: user.id,
    req,
  });
  return { user, ...tokens };
}

export async function refresh(refreshToken: string) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token.', 401);
  }
  const hash = hashToken(refreshToken);
  let userId: string | null = null;
  try {
    const session = await queryOne<{ UserId: string }>(
      `SELECT UserId FROM dbo.mh_sessions
       WHERE RefreshTokenHash = @Hash AND ExpiresAt > GETDATE()`,
      { Hash: hash },
    );
    if (session) userId = String(session.UserId);
  } catch {
    const row = memorySessions.get(hash);
    if (row && row.expires.getTime() > Date.now()) userId = row.userId;
  }
  if (userId == null) {
    const row = memorySessions.get(hash);
    if (row && row.expires.getTime() > Date.now()) userId = row.userId;
  }
  if (!userId || String(userId) !== String(claims.sub)) {
    throw new AppError('Refresh token expired.', 401);
  }
  const directory = await findDirectoryUserById(String(claims.sub));
  if (!directory?.isActive) {
    throw new AppError('Refresh token expired.', 401);
  }
  const user = directoryToAuth(directory);
  const tokens = await issueTokens(user);
  return { user, ...tokens };
}

export async function logout(user: AuthUser, req: Request): Promise<void> {
  try {
    await query(`DELETE FROM dbo.mh_sessions WHERE UserId = @Id`, { Id: user.id });
  } catch {
    /* mh_sessions may not exist yet */
  }
  for (const [key, row] of memorySessions) {
    if (row.userId === user.id) memorySessions.delete(key);
  }
  await writeAudit({ userId: user.id, action: AUDIT_ACTIONS.LOGOUT, module: 'auth', recordId: user.id, req });
}

export async function changeOwnPassword(_user: AuthUser, _current: string, _next: string): Promise<void> {
  throw new AppError('Passwords are managed in CLIENT_API_LIVE dbo.users.', 400);
}
