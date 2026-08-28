import { query, queryOne, querySoft, insert } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { ADMIN_PERMISSIONS, EMPLOYEE_PERMISSIONS, isTcsDepartment } from '../config/access.js';
import type { AuthUser } from '../types/index.js';

export async function listRoles() {
  const users = await query<{ Department: string | null }>(`SELECT Department FROM dbo.users`);
  const tcs = users.filter((u) => isTcsDepartment(u.Department)).length;
  return [
    {
      Id: 'ADMINISTRATOR',
      Code: 'ADMINISTRATOR',
      Name: 'Administrator',
      Description: 'TCS department — full access',
      IsSystem: true,
      UserCount: tcs,
    },
    {
      Id: 'EMPLOYEE',
      Code: 'EMPLOYEE',
      Name: 'Employee',
      Description: 'All other departments',
      IsSystem: true,
      UserCount: users.length - tcs,
    },
  ];
}

export async function getRole(id: string) {
  const code = String(id).toUpperCase();
  const roles = await listRoles();
  const role = roles.find((r) => r.Code === code || r.Id === id);
  if (!role) throw new AppError('Role not found.', 404);
  const codes = role.Code === 'ADMINISTRATOR' ? ADMIN_PERMISSIONS : EMPLOYEE_PERMISSIONS;
  const permissions = codes.map((c) => ({ Id: c, Code: c, Name: c, Module: c.split('.')[0] ?? c }));
  return { ...role, permissions };
}

export async function listPermissions() {
  return ADMIN_PERMISSIONS.map((c) => ({
    Id: c,
    Code: c,
    Name: c,
    Module: c.split('.')[0] ?? c,
    Description: null,
  }));
}

export async function setRolePermissions(_actor: AuthUser, _roleId: string, _permissionIds: string[]) {
  throw new AppError('Access is based on CLIENT_API_LIVE Department (TCS = full access).', 400);
}

export async function listDepartments(includeInactive = false) {
  return querySoft(
    `SELECT Id, Code, Name, Description, IsActive, CreatedAt
     FROM dbo.departments
     WHERE DeletedAt IS NULL ${includeInactive ? '' : 'AND IsActive = 1'}
     ORDER BY Name`,
  );
}

export async function createDepartment(actor: AuthUser, input: { code: string; name: string; description?: string }) {
  let id: string;
  try {
    id = await insert(
      `INSERT INTO dbo.departments (Code, Name, Description, CreatedBy, UpdatedBy)
       VALUES (@Code, @Name, @Description, @Actor, @Actor)`,
      {
        Code: input.code.trim().toUpperCase(),
        Name: input.name.trim(),
        Description: input.description ?? null,
        Actor: actor.id,
      },
    );
  } catch {
    throw new AppError('Department code already exists.', 409);
  }
  return queryOne(`SELECT Id, Code, Name, Description, IsActive FROM dbo.departments WHERE Id = @Id`, { Id: id });
}

export async function updateDepartment(
  actor: AuthUser,
  id: string,
  input: { name?: string; description?: string; isActive?: boolean },
) {
  const existing = await queryOne(`SELECT Id FROM dbo.departments WHERE Id = @Id AND DeletedAt IS NULL`, { Id: id });
  if (!existing) throw new AppError('Department not found.', 404);
  await query(
    `UPDATE dbo.departments SET
        Name = COALESCE(@Name, Name),
        Description = COALESCE(@Description, Description),
        IsActive = COALESCE(@IsActive, IsActive),
        UpdatedAt = SYSUTCDATETIME(),
        UpdatedBy = @Actor
     WHERE Id = @Id`,
    {
      Id: id,
      Name: input.name ?? null,
      Description: input.description ?? null,
      IsActive: input.isActive ?? null,
      Actor: actor.id,
    },
  );
  return queryOne(`SELECT Id, Code, Name, Description, IsActive FROM dbo.departments WHERE Id = @Id`, { Id: id });
}

export async function deleteDepartment(id: string) {
  await query(`UPDATE dbo.departments SET DeletedAt = SYSUTCDATETIME(), IsActive = 0 WHERE Id = @Id`, { Id: id });
}
