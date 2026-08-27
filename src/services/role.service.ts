import { query, queryOne, insert } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import type { AuthUser } from '../types/index.js';

export async function listRoles() {
  return query(
    `SELECT r.Id, r.Code, r.Name, r.Description, r.IsSystem,
            (SELECT COUNT(*) FROM dbo.users u WHERE u.RoleId = r.Id AND u.DeletedAt IS NULL) AS UserCount
     FROM dbo.roles r
     ORDER BY r.Name`,
  );
}

export async function getRole(id: string) {
  const role = await queryOne<{ Id: string; Code: string; Name: string; Description: string | null; IsSystem: boolean }>(
    `SELECT Id, Code, Name, Description, IsSystem FROM dbo.roles WHERE Id = @Id`,
    { Id: id },
  );
  if (!role) throw new AppError('Role not found.', 404);
  const permissions = await query<{ Id: string; Code: string; Name: string; Module: string }>(
    `SELECT p.Id, p.Code, p.Name, p.Module
     FROM dbo.role_permissions rp
     JOIN dbo.permissions p ON p.Id = rp.PermissionId
     WHERE rp.RoleId = @Id
     ORDER BY p.Module, p.Code`,
    { Id: id },
  );
  return { ...role, permissions };
}

export async function listPermissions() {
  return query(`SELECT Id, Code, Name, Module, Description FROM dbo.permissions ORDER BY Module, Code`);
}

export async function setRolePermissions(_actor: AuthUser, roleId: string, permissionIds: string[]) {
  const role = await getRole(roleId);
  if (role.Code === 'ADMINISTRATOR') {
    throw new AppError('Administrator permissions cannot be reduced.', 400);
  }
  await query(`DELETE FROM dbo.role_permissions WHERE RoleId = @RoleId`, { RoleId: roleId });
  for (const permissionId of permissionIds) {
    await query(
      `INSERT INTO dbo.role_permissions (RoleId, PermissionId) VALUES (@RoleId, @PermissionId)`,
      { RoleId: roleId, PermissionId: permissionId },
    );
  }
  return getRole(roleId);
}

export async function listDepartments(includeInactive = false) {
  return query(
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
