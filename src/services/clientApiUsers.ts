// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : Load and authenticate directory users from CLIENT_API_LIVE dbo.users
import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getClientApiPool, isClientApiConfigured, sql } from '../config/clientApi.js';
import { logger } from '../config/logger.js';
import { isDirectoryAdmin, roleCodeForDirectoryUser, roleNameForCode } from '../config/access.js';
import type { Paged } from '../types/index.js';
import type { UserRow } from '../types/db.js';

type RawUser = Record<string, unknown>;

const USER_COLUMNS = `Id, UserName, Email, Department, IsActive, Role, IsAdmin, last_login_time`;
const AUTH_COLUMNS = `${USER_COLUMNS}, PasswordHash`;

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
  role: string | null;
  isAdmin: boolean;
  isActive: boolean;
};

function toDirectoryUser(row: RawUser): DirectoryUser {
  const userName = String(pick(row, 'UserName', 'user_name') ?? '');
  const email = String(pick(row, 'Email', 'email') ?? '').trim();
  const departmentRaw = pick(row, 'Department', 'DepartmentName');
  const department = departmentRaw == null || departmentRaw === '' ? null : String(departmentRaw);
  const roleRaw = pick(row, 'Role');
  const id = pick(row, 'Id', 'UserId') ?? userName;
  return {
    id: String(id),
    userName,
    email: email || `${userName}@client-api.local`,
    department,
    role: roleRaw == null || roleRaw === '' ? null : String(roleRaw),
    isAdmin: isDirectoryAdmin({
      isAdmin: pick(row, 'IsAdmin'),
      role: roleRaw,
      department,
    }),
    isActive: toStatus(pick(row, 'IsActive', 'is_active', 'Status') ?? 'ACTIVE') === 'ACTIVE',
  };
}

export function mapClientApiUser(row: RawUser): UserRow {
  const userName = String(pick(row, 'UserName', 'user_name', 'Name', 'FullName') ?? '');
  const firstName = String(pick(row, 'FirstName', 'first_name') ?? '');
  const lastName = String(pick(row, 'LastName', 'last_name') ?? '');
  const names = firstName || lastName ? { first: firstName, last: lastName } : splitName(userName);
  const department = pick(row, 'DepartmentName', 'Department');
  const roleCode = roleCodeForDirectoryUser({
    department,
    role: pick(row, 'Role'),
    isAdmin: pick(row, 'IsAdmin'),
  });
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
    Designation: (pick(row, 'Designation', 'Role') as string | null) ?? null,
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

function passwordsEqual(given: string, stored: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hexDigest(algo: 'md5' | 'sha1' | 'sha256' | 'sha512', value: string): string {
  return createHash(algo).update(value, 'utf8').digest('hex');
}

async function passwordMatches(given: string, stored: unknown): Promise<boolean> {
  const text = String(stored ?? '').trim();
  if (!text) return false;
  if (passwordsEqual(given, text)) return true;
  if (text.startsWith('$2')) {
    try {
      return await bcrypt.compare(given, text);
    } catch {
      return false;
    }
  }
  const hex = text.replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return false;
  const candidates = [
    hexDigest('md5', given),
    hexDigest('sha1', given),
    hexDigest('sha256', given),
    hexDigest('sha512', given),
  ];
  return candidates.some((item) => item.toLowerCase() === hex.toLowerCase());
}

async function queryUsersByLogin(login: string, columns: string): Promise<RawUser | null> {
  const pool = await getClientApiPool();
  const request = pool.request();
  request.input('Login', sql.NVarChar(180), login);
  const result = await request.query(`
    SELECT TOP (1) ${columns}
    FROM dbo.users
    WHERE ${loginMatchSql()}
    ORDER BY Id
  `);
  return (result.recordset?.[0] as RawUser | undefined) ?? null;
}

export async function findDirectoryUserById(id: string): Promise<DirectoryUser | null> {
  if (!id.trim()) return null;
  const pool = await getClientApiPool();
  const request = pool.request();
  request.input('Id', sql.NVarChar(64), id.trim());
  try {
    const result = await request.query(`
      SELECT TOP (1) ${USER_COLUMNS}
      FROM dbo.users
      WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
      ORDER BY Id
    `);
    const row = result.recordset?.[0] as RawUser | undefined;
    return row ? toDirectoryUser(row) : null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'dbo.users lookup by id failed; retrying core columns',
    );
    const retry = pool.request();
    retry.input('Id', sql.NVarChar(64), id.trim());
    const result = await retry.query(`
      SELECT TOP (1) Id, UserName, Email, Department, IsActive, Role
      FROM dbo.users
      WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
      ORDER BY Id
    `);
    const row = result.recordset?.[0] as RawUser | undefined;
    return row ? toDirectoryUser(row) : null;
  }
}

export async function findDirectoryUser(login: string): Promise<DirectoryUser | null> {
  const row = await findDirectoryUserRow(login, USER_COLUMNS);
  return row ? toDirectoryUser(row) : null;
}

async function findDirectoryUserRow(login: string, columns: string): Promise<RawUser | null> {
  if (!isClientApiConfigured() || !login.trim()) return null;
  const trimmed = login.trim();
  const candidates = [trimmed];
  const at = trimmed.indexOf('@');
  if (at > 0) candidates.push(trimmed.slice(0, at));
  for (const value of candidates) {
    try {
      const row = await queryUsersByLogin(value, columns);
      if (row) return row;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'dbo.users lookup failed; retrying core columns',
      );
      const fallback = columns.includes('PasswordHash')
        ? `Id, UserName, Email, Department, IsActive, Role, PasswordHash`
        : `Id, UserName, Email, Department, IsActive, Role`;
      try {
        const row = await queryUsersByLogin(value, fallback);
        if (row) return row;
      } catch (inner) {
        logger.warn(
          { err: inner instanceof Error ? inner.message : String(inner) },
          'dbo.users lookup failed',
        );
      }
    }
  }
  return null;
}

export async function authenticateDirectory(login: string, password: string): Promise<DirectoryUser | null> {
  const given = String(password ?? '').trim();
  if (!isClientApiConfigured() || !login.trim() || !given) return null;
  const row = await findDirectoryUserRow(login, AUTH_COLUMNS);
  if (!row) {
    logger.warn({ login: login.trim() }, 'Login user not found in dbo.users');
    return null;
  }
  const hash = pick(row, 'PasswordHash');
  const known = pick(row, 'LastKnownPassword');
  if (!(await passwordMatches(given, hash)) && !(await passwordMatches(given, known))) {
    logger.warn({ login: login.trim() }, 'Login password did not match dbo.users.PasswordHash');
    return null;
  }
  const user = toDirectoryUser(row);
  if (!user.isActive) {
    logger.warn({ login: login.trim(), userName: user.userName }, 'Login user is inactive');
    return null;
  }
  return user;
}

export async function touchDirectoryLastLogin(id: string): Promise<void> {
  if (!id.trim()) return;
  try {
    const pool = await getClientApiPool();
    const request = pool.request();
    request.input('Id', sql.NVarChar(64), id.trim());
    await request.query(`
      UPDATE dbo.users
      SET last_login_time = GETDATE()
      WHERE CAST(Id AS nvarchar(64)) = @Id
    `);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Could not update dbo.users.last_login_time',
    );
  }
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
    SELECT ${USER_COLUMNS}
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
