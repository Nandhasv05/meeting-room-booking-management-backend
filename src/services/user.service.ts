import { query, queryOne, insert } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword } from '../utils/password.js';
import { writeAudit } from '../middleware/auditLogger.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { Request } from 'express';
import type { AuthUser, Paged } from '../types/index.js';
import type { UserRow } from '../types/db.js';
import {
  isClientApiConfigured,
  listClientApiUsers,
  searchClientApiUsers,
} from './clientApiUsers.js';

const USER_SELECT = `
  SELECT u.Id, u.EmployeeId, u.FirstName, u.LastName, u.Email, u.Phone, u.DepartmentId,
         d.Name AS DepartmentName, u.Designation, u.RoleId, r.Code AS RoleCode, r.Name AS RoleName,
         u.Status, u.LastLoginAt, u.CreatedAt
  FROM dbo.users u
  JOIN dbo.roles r ON r.Id = u.RoleId
  LEFT JOIN dbo.departments d ON d.Id = u.DepartmentId
`;

export async function listUsers(filters: {
  q?: string;
  departmentId?: string;
  roleId?: string;
  status?: string;
  page: number;
  pageSize: number;
}): Promise<Paged<UserRow>> {
  if (isClientApiConfigured()) {
    return listClientApiUsers(filters);
  }
  const where: string[] = ['u.DeletedAt IS NULL'];
  const inputs: Record<string, unknown> = {
    Offset: (filters.page - 1) * filters.pageSize,
    PageSize: filters.pageSize,
  };
  if (filters.q) {
    where.push(
      `(u.FirstName + ' ' + u.LastName LIKE @Q OR u.Email LIKE @Q OR u.EmployeeId LIKE @Q)`,
    );
    inputs.Q = `%${filters.q}%`;
  }
  if (filters.departmentId) {
    where.push('u.DepartmentId = @DepartmentId');
    inputs.DepartmentId = filters.departmentId;
  }
  if (filters.roleId) {
    where.push('u.RoleId = @RoleId');
    inputs.RoleId = filters.roleId;
  }
  if (filters.status) {
    where.push('u.Status = @Status');
    inputs.Status = filters.status;
  }
  const clause = where.join(' AND ');
  const totalRow = await queryOne<{ Cnt: number }>(
    `SELECT COUNT(*) AS Cnt FROM dbo.users u WHERE ${clause}`,
    inputs,
  );
  const items = await query<UserRow>(
    `${USER_SELECT} WHERE ${clause} ORDER BY u.LastName, u.FirstName
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY`,
    inputs,
  );
  return { items, page: filters.page, pageSize: filters.pageSize, total: totalRow?.Cnt ?? 0 };
}

export async function getUser(id: string): Promise<UserRow> {
  const row = await queryOne<UserRow>(`${USER_SELECT} WHERE u.Id = @Id AND u.DeletedAt IS NULL`, { Id: id });
  if (!row) throw new AppError('User not found.', 404);
  return row;
}

export async function createUser(
  actor: AuthUser,
  input: {
    employeeId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    departmentId?: string;
    designation?: string;
    roleId: string;
    password: string;
  },
  req: Request,
): Promise<UserRow> {
  const hash = await hashPassword(input.password);
  let id: string;
  try {
    id = await insert(
      `INSERT INTO dbo.users
        (EmployeeId, FirstName, LastName, Email, Phone, DepartmentId, Designation, PasswordHash, RoleId, Status, CreatedBy, UpdatedBy)
       VALUES
        (@EmployeeId, @FirstName, @LastName, @Email, @Phone, @DepartmentId, @Designation, @PasswordHash, @RoleId, N'ACTIVE', @Actor, @Actor)`,
      {
        EmployeeId: input.employeeId.trim(),
        FirstName: input.firstName.trim(),
        LastName: input.lastName.trim(),
        Email: input.email.trim().toLowerCase(),
        Phone: input.phone ?? null,
        DepartmentId: input.departmentId ?? null,
        Designation: input.designation ?? null,
        PasswordHash: hash,
        RoleId: input.roleId,
        Actor: actor.id,
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UQ_users_Email')) throw new AppError('Email is already in use.', 409);
    if (msg.includes('UQ_users_EmployeeId')) throw new AppError('Employee ID is already in use.', 409);
    throw err;
  }
  await writeAudit({
    userId: actor.id,
    action: AUDIT_ACTIONS.USER_CREATED,
    module: 'users',
    recordId: id,
    newValue: { email: input.email },
    req,
  });
  return getUser(id);
}

export async function updateUser(
  actor: AuthUser,
  id: string,
  input: Partial<{
    firstName: string;
    lastName: string;
    phone: string;
    departmentId: string | null;
    designation: string;
    roleId: string;
    status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  }>,
  req: Request,
): Promise<UserRow> {
  const existing = await getUser(id);
  const roleChanged = input.roleId && input.roleId !== existing.RoleId;
  await query(
    `UPDATE dbo.users SET
        FirstName = COALESCE(@FirstName, FirstName),
        LastName = COALESCE(@LastName, LastName),
        Phone = COALESCE(@Phone, Phone),
        DepartmentId = COALESCE(@DepartmentId, DepartmentId),
        Designation = COALESCE(@Designation, Designation),
        RoleId = COALESCE(@RoleId, RoleId),
        Status = COALESCE(@Status, Status),
        UpdatedAt = SYSUTCDATETIME(),
        UpdatedBy = @Actor
     WHERE Id = @Id AND DeletedAt IS NULL`,
    {
      Id: id,
      FirstName: input.firstName ?? null,
      LastName: input.lastName ?? null,
      Phone: input.phone ?? null,
      DepartmentId: input.departmentId === undefined ? null : input.departmentId,
      Designation: input.designation ?? null,
      RoleId: input.roleId ?? null,
      Status: input.status ?? null,
      Actor: actor.id,
    },
  );
  if (input.departmentId === null) {
    await query(`UPDATE dbo.users SET DepartmentId = NULL WHERE Id = @Id`, { Id: id });
  }
  if (roleChanged) {
    await writeAudit({
      userId: actor.id,
      action: AUDIT_ACTIONS.ROLE_CHANGED,
      module: 'users',
      recordId: id,
      oldValue: { roleId: existing.RoleId },
      newValue: { roleId: input.roleId },
      req,
    });
  }
  return getUser(id);
}

export async function resetPassword(actor: AuthUser, id: string, password: string): Promise<void> {
  await getUser(id);
  const hash = await hashPassword(password);
  await query(
    `UPDATE dbo.users SET PasswordHash = @Hash, RefreshTokenHash = NULL, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor WHERE Id = @Id`,
    { Hash: hash, Actor: actor.id, Id: id },
  );
}

export async function searchEmployees(q: string) {
  if (isClientApiConfigured()) {
    return searchClientApiUsers(q);
  }
  return query<UserRow>(
    `${USER_SELECT}
     WHERE u.DeletedAt IS NULL AND u.Status = N'ACTIVE'
       AND (u.FirstName + ' ' + u.LastName LIKE @Q OR u.EmployeeId LIKE @Q OR u.Email LIKE @Q)
     ORDER BY u.LastName OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY`,
    { Q: `%${q}%` },
  );
}
