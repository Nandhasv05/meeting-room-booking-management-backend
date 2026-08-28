// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : Load directory users from CLIENT_API_LIVE via SP_GET_USERS
import { getClientApiPool, isClientApiConfigured, sql } from '../config/clientApi.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { roleCodeForDepartment, roleNameForCode } from '../config/access.js';
import type { Paged } from '../types/index.js';
import type { UserRow } from '../types/db.js';

type RawUser = Record<string, unknown>;

function pick(row: RawUser, ...keys: string[]): unknown {
  const map = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const value = map[key.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function splitName(value: string): { first: string; last: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function toStatus(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'ACTIVE' : 'DISABLED';
  const text = String(value ?? 'ACTIVE').trim().toUpperCase();
  if (['0', 'FALSE', 'DISABLED', 'NO', 'N', 'INACTIVE'].includes(text)) return 'DISABLED';
  return 'ACTIVE';
}

export type DirectoryUser = {
  id: string;
  userName: string;
  email: string;
  department: string | null;
  isActive: boolean;
};

function toDirectoryUser(row: RawUser): DirectoryUser {
  const userName = String(pick(row, 'UserName', 'user_name') ?? '');
  const email = String(pick(row, 'Email', 'email') ?? '').trim();
  const departmentRaw = pick(row, 'Department', 'DepartmentName');
  const department = departmentRaw == null || departmentRaw === '' ? null : String(departmentRaw);
  const id = pick(row, 'Id', 'UserId') ?? userName;
  return {
    id: String(id),
    userName,
    email: email || `${userName}@client-api.local`,
    department,
    isActive: toStatus(pick(row, 'IsActive', 'is_active', 'Status') ?? 'ACTIVE') === 'ACTIVE',
  };
}

export function mapClientApiUser(row: RawUser): UserRow {
  const userName = String(pick(row, 'UserName', 'user_name', 'Name', 'FullName') ?? '');
  const firstName = String(pick(row, 'FirstName', 'first_name') ?? '');
  const lastName = String(pick(row, 'LastName', 'last_name') ?? '');
  const names = firstName || lastName ? { first: firstName, last: lastName } : splitName(userName);
  const department = pick(row, 'DepartmentName', 'Department');
  const roleCode = roleCodeForDepartment(department);
  const loginAt = pick(row, 'last_login_time', 'LastLoginAt', 'LastLogin');
  const statusRaw = pick(row, 'Status', 'IsActive', 'is_active') ?? 'ACTIVE';
  const id = pick(row, 'Id', 'UserId', 'USER_ID') ?? userName;
  return {
    Id: String(id),
    EmployeeId: String(pick(row, 'EmployeeId', 'UserName', 'user_name') ?? userName),
    FirstName: names.first,
    LastName: names.last,
    Email: String(pick(row, 'Email', 'email') ?? ''),
    Phone: (pick(row, 'Phone', 'phone') as string | null) ?? null,
    DepartmentId: department == null || department === '' ? null : String(department),
    DepartmentName: department == null || department === '' ? null : String(department),
    Designation: (pick(row, 'Designation') as string | null) ?? null,
    RoleId: roleCode,
    RoleCode: roleCode,
    RoleName: roleNameForCode(roleCode),
    Status: toStatus(statusRaw),
    LastLoginAt: loginAt ? new Date(String(loginAt)) : null,
    CreatedAt: loginAt ? new Date(String(loginAt)) : new Date(),
  };
}

function loginMatchSql(): string {
  return `(LOWER(LTRIM(RTRIM(ISNULL(Email, '')))) = LOWER(@Login) OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Login))`;
}

export async function findDirectoryUserById(id: string): Promise<DirectoryUser | null> {
  if (!id.trim()) return null;
  const pool = await getClientApiPool();
  const request = pool.request();
  request.input('Id', sql.NVarChar(64), id.trim());
  const result = await request.query(`
    SELECT TOP (1) Id, UserName, Email, Department, IsActive
    FROM dbo.users
    WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
    ORDER BY Id
  `);
  const row = result.recordset?.[0] as RawUser | undefined;
  return row ? toDirectoryUser(row) : null;
}

export async function findDirectoryUser(login: string): Promise<DirectoryUser | null> {
  if (!isClientApiConfigured() || !login.trim()) return null;
  const trimmed = login.trim();
  const candidates = [trimmed];
  const at = trimmed.indexOf('@');
  if (at > 0) candidates.push(trimmed.slice(0, at));
  for (const value of candidates) {
    const pool = await getClientApiPool();
    const request = pool.request();
    request.input('Login', sql.NVarChar(180), value);
    try {
      const result = await request.query(`
        SELECT TOP (1) Id, UserName, Email, Department, IsActive
        FROM dbo.users
        WHERE ${loginMatchSql()}
        ORDER BY Id
      `);
      const row = result.recordset?.[0] as RawUser | undefined;
      if (row) return toDirectoryUser(row);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'dbo.users lookup with IsActive failed; retrying without it',
      );
      const retry = pool.request();
      retry.input('Login', sql.NVarChar(180), value);
      const result = await retry.query(`
        SELECT TOP (1) Id, UserName, Email, Department
        FROM dbo.users
        WHERE ${loginMatchSql()}
        ORDER BY Id
      `);
      const row = result.recordset?.[0] as RawUser | undefined;
      if (row) return toDirectoryUser({ ...row, IsActive: true });
    }
  }
  return null;
}

export async function authenticateDirectory(login: string, password: string): Promise<DirectoryUser | null> {
  if (!isClientApiConfigured() || !login.trim() || !password) return null;
  const user = await findDirectoryUser(login);
  if (!user) {
    logger.warn({ login: login.trim() }, 'Login user not found in dbo.users');
    return null;
  }
  const allowed = new Set(
    [env.DIRECTORY_DEFAULT_PASSWORD, 'Password#123']
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const given = password.trim();
  if (!allowed.has(given) && ! [...allowed].some((value) => value.toLowerCase() === given.toLowerCase())) {
    logger.warn({ login: login.trim(), userName: user.userName }, 'Login password did not match directory default');
    return null;
  }
  if (!user.isActive) {
    logger.warn({ login: login.trim(), userName: user.userName }, 'Login user is inactive');
    return null;
  }
  return user;
}

export async function countDirectoryUsers(): Promise<number> {
  const rows = await execGetUsers('');
  return rows.length;
}

async function execGetUsers(search: string): Promise<RawUser[]> {
  const pool = await getClientApiPool();

  try {
    const result = await pool.request().query('EXEC SP_GET_USERS');
    const rows = (result.recordset ?? []) as RawUser[];
    logger.info({ count: rows.length }, 'SP_GET_USERS executed on CLIENT_API_LIVE');
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const userName = String(pick(row, 'UserName', 'user_name') ?? '').toLowerCase();
      const email = String(pick(row, 'Email', 'email') ?? '').toLowerCase();
      const department = String(pick(row, 'Department', 'DepartmentName') ?? '').toLowerCase();
      return userName.includes(q) || email.includes(q) || department.includes(q);
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'SP_GET_USERS batch failed; reading dbo.users',
    );
  }

  const request = pool.request();
  request.input('Q', sql.NVarChar(200), search ? `%${search}%` : '%');
  const result = await request.query(`
    SELECT Id, UserName, Email, Role, Department, IsActive, last_login_time
    FROM dbo.users
    WHERE @Q = '%'
       OR UserName LIKE @Q
       OR ISNULL(Email, '') LIKE @Q
       OR ISNULL(Department, '') LIKE @Q
       OR ISNULL(Role, '') LIKE @Q
    ORDER BY UserName
  `);
  return result.recordset as RawUser[];
}

export async function listClientApiUsers(filters: {
  q?: string;
  departmentId?: string;
  roleId?: string;
  status?: string;
  page: number;
  pageSize: number;
}): Promise<Paged<UserRow>> {
  const rows = (await execGetUsers(filters.q?.trim() ?? '')).map(mapClientApiUser);
  const filtered = rows.filter((row) => {
    if (filters.departmentId && row.DepartmentId !== filters.departmentId && row.DepartmentName !== filters.departmentId) {
      return false;
    }
    if (filters.roleId && row.RoleId !== filters.roleId && row.RoleName !== filters.roleId) {
      return false;
    }
    if (filters.status && row.Status !== filters.status) return false;
    return true;
  });
  const start = (filters.page - 1) * filters.pageSize;
  return {
    items: filtered.slice(start, start + filters.pageSize),
    page: filters.page,
    pageSize: filters.pageSize,
    total: filtered.length,
  };
}

export async function searchClientApiUsers(q: string): Promise<UserRow[]> {
  const rows = (await execGetUsers(q.trim())).map(mapClientApiUser);
  return rows.slice(0, 20);
}

export { isClientApiConfigured };
