// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : Load directory users from CLIENT_API_LIVE via SP_GET_USERS
import { getClientApiPool, isClientApiConfigured, sql } from '../config/clientApi.js';
import { logger } from '../config/logger.js';
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
  if (['1', 'TRUE', 'ACTIVE', 'YES', 'Y'].includes(text)) return 'ACTIVE';
  return 'DISABLED';
}

export function mapClientApiUser(row: RawUser): UserRow {
  const userName = String(pick(row, 'UserName', 'user_name', 'Name', 'FullName') ?? '');
  const firstName = String(pick(row, 'FirstName', 'first_name') ?? '');
  const lastName = String(pick(row, 'LastName', 'last_name') ?? '');
  const names = firstName || lastName ? { first: firstName, last: lastName } : splitName(userName);
  const role = String(pick(row, 'RoleName', 'Role', 'role') ?? 'USER');
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
    DepartmentId: pick(row, 'DepartmentId') == null ? null : String(pick(row, 'DepartmentId')),
    DepartmentName: (pick(row, 'DepartmentName', 'Department') as string | null) ?? null,
    Designation: (pick(row, 'Designation') as string | null) ?? null,
    RoleId: String(pick(row, 'RoleId', 'Role') ?? role),
    RoleCode: role,
    RoleName: role,
    Status: toStatus(statusRaw),
    LastLoginAt: loginAt ? new Date(String(loginAt)) : null,
    CreatedAt: loginAt ? new Date(String(loginAt)) : new Date(),
  };
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
