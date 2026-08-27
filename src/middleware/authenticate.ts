import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import { query } from '../config/database.js';
import type { AuthUser } from '../types/index.js';

type UserRow = {
  Id: string;
  Email: string;
  EmployeeId: string;
  FirstName: string;
  LastName: string;
  RoleId: string;
  RoleCode: string;
  RoleName: string;
  DepartmentId: string | null;
  Status: string;
};

type PermRow = { Code: string };

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('Authentication required.', 401);
    }
    const token = header.slice(7);
    const claims = verifyAccessToken(token);
    const user = await query<UserRow>(
      `SELECT u.Id, u.Email, u.EmployeeId, u.FirstName, u.LastName, u.RoleId,
              r.Code AS RoleCode, r.Name AS RoleName, u.DepartmentId, u.Status
       FROM dbo.users u
       JOIN dbo.roles r ON r.Id = u.RoleId
       WHERE u.Id = @Id AND u.DeletedAt IS NULL`,
      { Id: claims.sub },
    );
    const row = user[0];
    if (!row || row.Status !== 'ACTIVE') {
      throw new AppError('Account is not active.', 401);
    }
    const perms = await query<PermRow>(
      `SELECT p.Code
       FROM dbo.role_permissions rp
       JOIN dbo.permissions p ON p.Id = rp.PermissionId
       WHERE rp.RoleId = @RoleId`,
      { RoleId: row.RoleId },
    );
    const auth: AuthUser = {
      id: String(row.Id),
      email: row.Email,
      employeeId: row.EmployeeId,
      firstName: row.FirstName,
      lastName: row.LastName,
      roleId: String(row.RoleId),
      roleCode: row.RoleCode,
      roleName: row.RoleName,
      departmentId: row.DepartmentId == null ? null : String(row.DepartmentId),
      permissions: perms.map((p) => p.Code),
    };
    req.user = auth;
    next();
  } catch (err) {
    if (err instanceof AppError) next(err);
    else next(new AppError('Invalid or expired session.', 401));
  }
}

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
      next(new AppError('You do not have permission to perform this action.', 403));
      return;
    }
    next();
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  void authenticate(req, _res, next);
}
