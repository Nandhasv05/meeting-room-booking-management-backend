import { query, queryOne, insert } from '../config/database.js';
import { querySoft } from '../config/sqlSoft.js';
import { AppError } from '../utils/AppError.js';
import { ADMIN_PERMISSIONS, EMPLOYEE_PERMISSIONS, isDirectoryAdmin } from '../config/directoryAccess.js';
import type { AuthUser } from '../types/index.js';

export async function listRoles() {
  const users = await query<{ Department: string | null; Role: string | null; IsAdmin: unknown }>(
    `SELECT Department, Role, IsAdmin FROM dbo.users`,
  );
  const admins = users.filter((u) =>
    isDirectoryAdmin({ department: u.Department, role: u.Role, isAdmin: u.IsAdmin }),
  ).length;
  return [
    {
      Id: 'ADMINISTRATOR',
      Code: 'ADMINISTRATOR',
      Name: 'Administrator',
      Description: 'IsAdmin, Role Admin/SuperAdmin/it_admin, or Department TCS — full access',
      IsSystem: true,
      UserCount: admins,
    },
    {
      Id: 'EMPLOYEE',
      Code: 'EMPLOYEE',
      Name: 'Employee',
      Description: 'All other dbo.users rows',
      IsSystem: true,
      UserCount: users.length - admins,
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
  throw new AppError('Access is based on CLIENT_API_LIVE dbo.users Role (Admin / it_admin) or Department TCS.', 400);
}

function departmentCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 30) || 'DEPT';
}

export async function ensureDirectoryDepartments(): Promise<void> {
  const names = await querySoft<{ Department: string }>(
    `SELECT DISTINCT LTRIM(RTRIM(Department)) AS Department
     FROM dbo.users
     WHERE Department IS NOT NULL AND LTRIM(RTRIM(Department)) <> N''`,
  );
  for (const row of names) {
    const name = String(row.Department ?? '').trim();
    if (!name) continue;
    const code = departmentCode(name);
    await querySoft(
      `IF NOT EXISTS (
          SELECT 1 FROM dbo.departments
          WHERE DeletedAt IS NULL
            AND (UPPER(LTRIM(RTRIM(Name))) = UPPER(@Name) OR UPPER(LTRIM(RTRIM(Code))) = UPPER(@Code))
        )
        INSERT INTO dbo.departments (Code, Name) VALUES (@Code, @Name)`,
      { Name: name, Code: code },
    );
  }
}

export async function resolveDepartmentId(value: string): Promise<string> {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new AppError('Department is required.', 422);
  await ensureDirectoryDepartments();
  const existing = await queryOne<{ Id: string | number }>(
    `SELECT TOP (1) Id FROM dbo.departments
     WHERE DeletedAt IS NULL AND (
       CAST(Id AS nvarchar(64)) = @Value
       OR UPPER(LTRIM(RTRIM(Code))) = UPPER(@Value)
       OR UPPER(LTRIM(RTRIM(Name))) = UPPER(@Value)
     )
     ORDER BY Id`,
    { Value: trimmed },
  );
  if (existing) return String(existing.Id);
  try {
    return await insert(`INSERT INTO dbo.departments (Code, Name) VALUES (@Code, @Name)`, {
      Code: departmentCode(trimmed),
      Name: trimmed,
    });
  } catch {
    const again = await queryOne<{ Id: string | number }>(
      `SELECT TOP (1) Id FROM dbo.departments
       WHERE DeletedAt IS NULL AND (
         UPPER(LTRIM(RTRIM(Code))) = UPPER(@Value) OR UPPER(LTRIM(RTRIM(Name))) = UPPER(@Value)
       )
       ORDER BY Id`,
      { Value: trimmed },
    );
    if (again) return String(again.Id);
    throw new AppError('Department was not found.', 422);
  }
}

export async function listDepartments(includeInactive = false) {
  await ensureDirectoryDepartments();
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
