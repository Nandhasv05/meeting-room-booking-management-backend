import { query, queryOne } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { hashToken, newId } from '../utils/ids.js';
import { writeAudit } from '../middleware/auditLogger.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Request } from 'express';
import type { AuthUser } from '../types/index.js';

type LoginRow = {
  Id: string;
  Email: string;
  EmployeeId: string;
  FirstName: string;
  LastName: string;
  PasswordHash: string;
  RoleId: string;
  RoleCode: string;
  RoleName: string;
  DepartmentId: string | null;
  Status: string;
};

async function loadPermissions(roleId: string): Promise<string[]> {
  const rows = await query<{ Code: string }>(
    `SELECT p.Code FROM dbo.role_permissions rp
     JOIN dbo.permissions p ON p.Id = rp.PermissionId
     WHERE rp.RoleId = @RoleId`,
    { RoleId: roleId },
  );
  return rows.map((r) => r.Code);
}

function toPublic(row: LoginRow, permissions: string[]): AuthUser {
  return {
    id: String(row.Id),
    email: row.Email,
    employeeId: row.EmployeeId,
    firstName: row.FirstName,
    lastName: row.LastName,
    roleId: String(row.RoleId),
    roleCode: row.RoleCode,
    roleName: row.RoleName,
    departmentId: row.DepartmentId == null ? null : String(row.DepartmentId),
    permissions,
  };
}

async function issueTokens(userId: string, email: string, role: string) {
  const jti = newId();
  const refreshToken = signRefreshToken(userId, jti);
  const accessToken = signAccessToken(userId, email, role);
  const refreshHash = hashToken(refreshToken);
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    `UPDATE dbo.users SET RefreshTokenHash = @Hash, RefreshTokenExpiresAt = @Exp, LastLoginAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id`,
    { Hash: refreshHash, Exp: expires, Id: userId },
  );
  return { accessToken, refreshToken };
}

export async function login(email: string, password: string, req: Request) {
  const row = await queryOne<LoginRow>(
    `SELECT u.Id, u.Email, u.EmployeeId, u.FirstName, u.LastName, u.PasswordHash,
            u.RoleId, r.Code AS RoleCode, r.Name AS RoleName, u.DepartmentId, u.Status
     FROM dbo.users u
     JOIN dbo.roles r ON r.Id = u.RoleId
     WHERE u.Email = @Email AND u.DeletedAt IS NULL`,
    { Email: email.trim().toLowerCase() },
  );
  if (!row || !(await verifyPassword(password, row.PasswordHash))) {
    throw new AppError('Invalid email or password.', 401);
  }
  if (row.Status !== 'ACTIVE') {
    throw new AppError('Account is disabled.', 403);
  }
  const permissions = await loadPermissions(row.RoleId);
  const tokens = await issueTokens(row.Id, row.Email, row.RoleCode);
  await writeAudit({
    userId: row.Id,
    action: AUDIT_ACTIONS.LOGIN,
    module: 'auth',
    recordId: row.Id,
    req,
  });
  return { user: toPublic(row, permissions), ...tokens };
}

export async function refresh(refreshToken: string) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token.', 401);
  }
  const hash = hashToken(refreshToken);
  const row = await queryOne<LoginRow>(
    `SELECT u.Id, u.Email, u.EmployeeId, u.FirstName, u.LastName, u.PasswordHash,
            u.RoleId, r.Code AS RoleCode, r.Name AS RoleName, u.DepartmentId, u.Status
     FROM dbo.users u
     JOIN dbo.roles r ON r.Id = u.RoleId
     WHERE u.Id = @Id AND u.DeletedAt IS NULL AND u.RefreshTokenHash = @Hash
       AND u.RefreshTokenExpiresAt > SYSUTCDATETIME()`,
    { Id: claims.sub, Hash: hash },
  );
  if (!row || row.Status !== 'ACTIVE') {
    throw new AppError('Refresh token expired.', 401);
  }
  const permissions = await loadPermissions(row.RoleId);
  const tokens = await issueTokens(row.Id, row.Email, row.RoleCode);
  return { user: toPublic(row, permissions), ...tokens };
}

export async function logout(user: AuthUser, req: Request): Promise<void> {
  await query(
    `UPDATE dbo.users SET RefreshTokenHash = NULL, RefreshTokenExpiresAt = NULL, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id`,
    { Id: user.id },
  );
  await writeAudit({ userId: user.id, action: AUDIT_ACTIONS.LOGOUT, module: 'auth', recordId: user.id, req });
}

export async function changeOwnPassword(user: AuthUser, current: string, next: string): Promise<void> {
  const row = await queryOne<{ PasswordHash: string }>(`SELECT PasswordHash FROM dbo.users WHERE Id = @Id`, {
    Id: user.id,
  });
  if (!row || !(await verifyPassword(current, row.PasswordHash))) {
    throw new AppError('Current password is incorrect.', 400);
  }
  const hash = await hashPassword(next);
  await query(`UPDATE dbo.users SET PasswordHash = @Hash, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id`, {
    Hash: hash,
    Id: user.id,
  });
}

export { loadPermissions, hashPassword };
