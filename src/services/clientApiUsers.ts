// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : Load and authenticate directory users from CLIENT_API_LIVE dbo.users
import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getClientApiPool, isClientApiConfigured, sql } from '../config/clientApi.js';
import { logger } from '../config/logger.js';
import { isDirectoryAdmin, roleCodeForDirectoryUser, roleNameForCode } from '../config/directoryAccess.js';
import { AppError } from '../utils/AppError.js';
import type { AuthUser, Paged } from '../types/index.js';
import type { UserRow } from '../types/db.js';

type RawUser = Record<string, unknown>;

const USER_COLUMNS = `Id, UserName, Email, Department, IsActive, Role, last_login_time`;
const AUTH_COLUMNS = `${USER_COLUMNS}, PasswordHash, LastKnownPassword`;

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

function isHashedSecret(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith('$2')) return true;
  const hex = text.replace(/^0x/i, '');
  return /^[0-9a-f]+$/i.test(hex) && hex.length >= 32 && hex.length % 2 === 0;
}

export async function readRevealablePassword(id: string): Promise<string> {
  if (!id.trim()) return '';
  const pool = await getClientApiPool();
  const attempts = [
    `SELECT TOP (1) LastKnownPassword, PasswordHash
     FROM dbo.users
     WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)`,
    `SELECT TOP (1) PasswordHash
     FROM dbo.users
     WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)`,
  ];
  for (const sqlText of attempts) {
    try {
      const request = pool.request();
      request.input('Id', sql.NVarChar(64), id.trim());
      const result = await request.query(sqlText);
      const row = (result.recordset?.[0] ?? {}) as RawUser;
      const known = String(pick(row, 'LastKnownPassword') ?? '').trim();
      const hash = String(pick(row, 'PasswordHash') ?? '').trim();
      if (known && !isHashedSecret(known)) return known;
      if (hash && !isHashedSecret(hash)) return hash;
      return '';
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not read stored password for admin reveal',
      );
    }
  }
  return '';
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

function loginMatchSql(): string {
  return `(LOWER(LTRIM(RTRIM(ISNULL(Email, '')))) = LOWER(@Login) OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Login))`;
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

  const filters = `
    WHERE @Q = '%'
       OR UserName LIKE @Q
       OR ISNULL(Email, '') LIKE @Q
       OR ISNULL(Department, '') LIKE @Q
       OR ISNULL(Role, '') LIKE @Q
    ORDER BY UserName
  `;
  const request = pool.request();
  request.input('Q', sql.NVarChar(200), search ? `%${search}%` : '%');
  try {
    const result = await request.query(`SELECT ${USER_COLUMNS} FROM dbo.users ${filters}`);
    return result.recordset as RawUser[];
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'dbo.users list with IsAdmin failed; reading core columns',
    );
    const retry = pool.request();
    retry.input('Q', sql.NVarChar(200), search ? `%${search}%` : '%');
    const result = await retry.query(
      `SELECT Id, UserName, Email, Department, IsActive, Role FROM dbo.users ${filters}`,
    );
    return result.recordset as RawUser[];
  }
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

function directoryRoleFields(roleId?: string) {
  const admin = String(roleId ?? '').toUpperCase() === 'ADMINISTRATOR';
  return { role: admin ? 'Admin' : 'Employee', isAdmin: admin ? 1 : 0 };
}

function sqlError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function passwordStores(password: string): Promise<string[]> {
  return [
    await bcrypt.hash(password, 10),
    hexDigest('sha256', password),
    password,
  ];
}

async function mappedUserById(id: string): Promise<UserRow | null> {
  const directory = await findDirectoryUserById(id);
  if (!directory) return null;
  return mapClientApiUser({
    Id: directory.id,
    UserName: directory.userName,
    Email: directory.email,
    Department: directory.department,
    IsActive: directory.isActive,
    Role: directory.role,
    IsAdmin: directory.isAdmin,
  });
}

async function countDirectoryAdmins(): Promise<number> {
  const rows = (await execGetUsers('')).map(mapClientApiUser);
  return rows.filter((row) => row.RoleId === 'ADMINISTRATOR' && row.Status === 'ACTIVE').length;
}

async function assertNotLastAdmin(id: string, nextRoleId?: string, nextStatus?: string): Promise<void> {
  const current = await mappedUserById(id);
  if (!current || current.RoleId !== 'ADMINISTRATOR' || current.Status !== 'ACTIVE') return;
  const demoting = nextRoleId === 'EMPLOYEE';
  const disabling = nextStatus === 'DISABLED' || nextStatus === 'LOCKED';
  if (!demoting && !disabling) return;
  if ((await countDirectoryAdmins()) <= 1) {
    throw new AppError('Keep at least one active administrator.', 400);
  }
}

export type DirectoryUserWrite = {
  employeeId: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  department?: string | null;
  departmentId?: string | null;
  designation?: string;
  roleId: string;
  password: string;
  status?: 'ACTIVE' | 'DISABLED';
};

async function tryWriteProfile(
  id: string,
  input: { firstName?: string; lastName?: string; phone?: string; designation?: string },
): Promise<void> {
  const pool = await getClientApiPool();
  const attempts = [
    `UPDATE dbo.users SET FirstName = @FirstName, LastName = @LastName, Phone = @Phone, Designation = @Designation
     WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)`,
    `UPDATE dbo.users SET FirstName = @FirstName, LastName = @LastName, Phone = @Phone
     WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)`,
    `UPDATE dbo.users SET Phone = @Phone
     WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)`,
  ];
  for (const sqlText of attempts) {
    try {
      const request = pool.request();
      request.input('Id', sql.NVarChar(64), id);
      request.input('FirstName', sql.NVarChar(80), input.firstName?.trim() || null);
      request.input('LastName', sql.NVarChar(80), input.lastName?.trim() || null);
      request.input('Phone', sql.NVarChar(30), input.phone?.trim() || null);
      request.input('Designation', sql.NVarChar(120), input.designation?.trim() || null);
      await request.query(sqlText);
      return;
    } catch (err) {
      logger.warn({ err: sqlError(err) }, 'dbo.users profile columns not fully available');
    }
  }
}

export async function createDirectoryUser(_actor: AuthUser, input: DirectoryUserWrite): Promise<UserRow> {
  const userName = input.employeeId.trim();
  const email = input.email.trim();
  if (await findDirectoryUser(userName)) throw new AppError('Username already exists.', 409);
  if (await findDirectoryUser(email)) throw new AppError('Email already exists.', 409);

  const hashes = await passwordStores(input.password);
  const { role, isAdmin } = directoryRoleFields(input.roleId);
  const isActive = input.status === 'DISABLED' ? 0 : 1;
  const department = String(input.department ?? input.departmentId ?? '').trim() || null;
  const pool = await getClientApiPool();

  const insertWith = (hash: string): Array<() => Promise<void>> => [
    async () => {
      const request = pool.request();
      request.input('UserName', sql.NVarChar(80), userName);
      request.input('Email', sql.NVarChar(180), email);
      request.input('PasswordHash', sql.NVarChar(200), hash);
      request.input('LastKnownPassword', sql.NVarChar(200), input.password);
      request.input('IsActive', sql.Bit, isActive);
      request.input('Role', sql.NVarChar(80), role);
      request.input('Department', sql.NVarChar(80), department);
      await request.query(`
        INSERT INTO dbo.users (UserName, Email, PasswordHash, LastKnownPassword, IsActive, Role, Department)
        VALUES (@UserName, @Email, @PasswordHash, @LastKnownPassword, @IsActive, @Role, @Department)
      `);
    },
    async () => {
      const request = pool.request();
      request.input('UserName', sql.NVarChar(80), userName);
      request.input('Email', sql.NVarChar(180), email);
      request.input('PasswordHash', sql.NVarChar(200), hash);
      request.input('IsActive', sql.Bit, isActive);
      request.input('Role', sql.NVarChar(80), role);
      request.input('Department', sql.NVarChar(80), department);
      await request.query(`
        INSERT INTO dbo.users (UserName, Email, PasswordHash, IsActive, Role, Department)
        VALUES (@UserName, @Email, @PasswordHash, @IsActive, @Role, @Department)
      `);
    },
    async () => {
      const next = pool.request();
      const nextId = await next.query(`
        SELECT ISNULL(MAX(TRY_CONVERT(int, Id)), 0) + 1 AS NextId FROM dbo.users
      `);
      const id = Number(nextId.recordset?.[0]?.NextId ?? 1);
      const request = pool.request();
      request.input('Id', sql.Int, id);
      request.input('UserName', sql.NVarChar(80), userName);
      request.input('Email', sql.NVarChar(180), email);
      request.input('PasswordHash', sql.NVarChar(200), hash);
      request.input('IsActive', sql.Bit, isActive);
      request.input('Role', sql.NVarChar(80), role);
      request.input('Department', sql.NVarChar(80), department);
      await request.query(`
        INSERT INTO dbo.users (Id, UserName, Email, PasswordHash, IsActive, Role, Department)
        VALUES (@Id, @UserName, @Email, @PasswordHash, @IsActive, @Role, @Department)
      `);
    },
    async () => {
      const request = pool.request();
      request.input('UserName', sql.NVarChar(80), userName);
      request.input('Email', sql.NVarChar(180), email);
      request.input('PasswordHash', sql.NVarChar(200), hash);
      request.input('LastKnownPassword', sql.NVarChar(200), input.password);
      request.input('IsActive', sql.Bit, isActive);
      request.input('Role', sql.NVarChar(80), role);
      request.input('Department', sql.NVarChar(80), department);
      request.input('IsAdmin', sql.Bit, isAdmin);
      await request.query(`
        INSERT INTO dbo.users (UserName, Email, PasswordHash, LastKnownPassword, IsActive, Role, Department, IsAdmin)
        VALUES (@UserName, @Email, @PasswordHash, @LastKnownPassword, @IsActive, @Role, @Department, @IsAdmin)
      `);
    },
  ];

  let last = '';
  outer: for (const hash of hashes) {
    for (const attempt of insertWith(hash)) {
      try {
        await attempt();
        last = '';
        break outer;
      } catch (err) {
        last = sqlError(err);
        logger.warn({ err: last }, 'dbo.users insert attempt failed');
      }
    }
  }
  if (last) throw new AppError(`Could not create user. ${last}`, 400);

  const created = await findDirectoryUser(userName);
  if (!created) throw new AppError('User was created but could not be loaded.', 500);
  await tryWriteProfile(created.id, input);
  return mapClientApiUser({
    Id: created.id,
    UserName: created.userName,
    Email: created.email,
    Department: created.department,
    IsActive: created.isActive,
    Role: created.role,
    IsAdmin: created.isAdmin,
    FirstName: input.firstName,
    LastName: input.lastName,
    Phone: input.phone,
    Designation: input.designation,
  });
}

export async function updateDirectoryUser(
  actor: AuthUser,
  id: string,
  input: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    department: string | null;
    departmentId: string | null;
    designation: string;
    roleId: string;
    status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
    password: string;
    employeeId: string;
  }>,
): Promise<UserRow> {
  const current = await findDirectoryUserById(id);
  if (!current) throw new AppError('User not found.', 404);
  if (actor.id === current.id && (input.status === 'DISABLED' || input.status === 'LOCKED')) {
    throw new AppError('You cannot disable your own account.', 400);
  }
  await assertNotLastAdmin(current.id, input.roleId, input.status);

  if (input.email && input.email.trim().toLowerCase() !== current.email.toLowerCase()) {
    const taken = await findDirectoryUser(input.email.trim());
    if (taken && taken.id !== current.id) throw new AppError('Email already exists.', 409);
  }
  if (input.employeeId) {
    const nextName = input.employeeId.trim();
    if (nextName && nextName.toLowerCase() !== current.userName.toLowerCase()) {
      const taken = await findDirectoryUser(nextName);
      if (taken && taken.id !== current.id) throw new AppError('Username already exists.', 409);
    }
  }

  const department =
    input.department !== undefined || input.departmentId !== undefined
      ? String(input.department ?? input.departmentId ?? '').trim() || null
      : undefined;
  const roleFields = input.roleId ? directoryRoleFields(input.roleId) : null;
  const isActive =
    input.status === undefined ? undefined : input.status === 'ACTIVE' ? 1 : 0;

  const pool = await getClientApiPool();
  const attempts: Array<() => Promise<void>> = [
    async () => {
      const request = pool.request();
      request.input('Id', sql.NVarChar(64), current.id);
      request.input('UserName', sql.NVarChar(80), input.employeeId?.trim() ?? null);
      request.input('HasUserName', sql.Bit, input.employeeId ? 1 : 0);
      request.input('Email', sql.NVarChar(180), input.email?.trim() ?? null);
      request.input('HasEmail', sql.Bit, input.email ? 1 : 0);
      request.input('Department', sql.NVarChar(80), department ?? null);
      request.input('HasDept', sql.Bit, department !== undefined ? 1 : 0);
      request.input('Role', sql.NVarChar(80), roleFields?.role ?? null);
      request.input('HasRole', sql.Bit, roleFields ? 1 : 0);
      request.input('IsActive', sql.Bit, isActive ?? 0);
      request.input('HasActive', sql.Bit, isActive !== undefined ? 1 : 0);
      await request.query(`
        UPDATE dbo.users
        SET UserName = CASE WHEN @HasUserName = 1 THEN @UserName ELSE UserName END,
            Email = CASE WHEN @HasEmail = 1 THEN @Email ELSE Email END,
            Department = CASE WHEN @HasDept = 1 THEN @Department ELSE Department END,
            Role = CASE WHEN @HasRole = 1 THEN @Role ELSE Role END,
            IsActive = CASE WHEN @HasActive = 1 THEN @IsActive ELSE IsActive END
        WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
      `);
    },
    async () => {
      const request = pool.request();
      request.input('Id', sql.NVarChar(64), current.id);
      request.input('UserName', sql.NVarChar(80), input.employeeId?.trim() ?? null);
      request.input('HasUserName', sql.Bit, input.employeeId ? 1 : 0);
      request.input('Email', sql.NVarChar(180), input.email?.trim() ?? null);
      request.input('HasEmail', sql.Bit, input.email ? 1 : 0);
      request.input('Department', sql.NVarChar(80), department ?? null);
      request.input('HasDept', sql.Bit, department !== undefined ? 1 : 0);
      request.input('Role', sql.NVarChar(80), roleFields?.role ?? null);
      request.input('HasRole', sql.Bit, roleFields ? 1 : 0);
      request.input('IsAdmin', sql.Bit, roleFields?.isAdmin ?? 0);
      request.input('IsActive', sql.Bit, isActive ?? 0);
      request.input('HasActive', sql.Bit, isActive !== undefined ? 1 : 0);
      await request.query(`
        UPDATE dbo.users
        SET UserName = CASE WHEN @HasUserName = 1 THEN @UserName ELSE UserName END,
            Email = CASE WHEN @HasEmail = 1 THEN @Email ELSE Email END,
            Department = CASE WHEN @HasDept = 1 THEN @Department ELSE Department END,
            Role = CASE WHEN @HasRole = 1 THEN @Role ELSE Role END,
            IsAdmin = CASE WHEN @HasRole = 1 THEN @IsAdmin ELSE IsAdmin END,
            IsActive = CASE WHEN @HasActive = 1 THEN @IsActive ELSE IsActive END
        WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
      `);
    },
  ];

  let last = '';
  for (const attempt of attempts) {
    try {
      await attempt();
      last = '';
      break;
    } catch (err) {
      last = sqlError(err);
      logger.warn({ err: last }, 'dbo.users update attempt failed');
    }
  }
  if (last) throw new AppError(`Could not update user. ${last}`, 400);

  if (input.password) {
    await writeDirectoryPassword(current.id, input.password);
  }
  await tryWriteProfile(current.id, input);

  const updated = await mappedUserById(current.id);
  if (!updated) throw new AppError('User updated but could not be loaded.', 500);
  return updated;
}

async function writeDirectoryPassword(id: string, password: string): Promise<void> {
  const hashed = await bcrypt.hash(password, 10);
  const pool = await getClientApiPool();
  try {
    const request = pool.request();
    request.input('Id', sql.NVarChar(64), id);
    request.input('PasswordHash', sql.NVarChar(200), hashed);
    request.input('LastKnownPassword', sql.NVarChar(200), password);
    await request.query(`
      UPDATE dbo.users
      SET PasswordHash = @PasswordHash, LastKnownPassword = @LastKnownPassword
      WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
    `);
    return;
  } catch (err) {
    logger.warn({ err: sqlError(err) }, 'LastKnownPassword column not available; writing hash only');
  }
  const hashes = await passwordStores(password);
  let last = '';
  for (const hash of hashes) {
    try {
      const request = pool.request();
      request.input('Id', sql.NVarChar(64), id);
      request.input('PasswordHash', sql.NVarChar(200), hash);
      await request.query(`
        UPDATE dbo.users
        SET PasswordHash = @PasswordHash
        WHERE CAST(Id AS nvarchar(64)) = @Id OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(@Id)
      `);
      return;
    } catch (inner) {
      last = sqlError(inner);
    }
  }
  throw new AppError(`Could not update password. ${last}`, 400);
}

export async function resetDirectoryPassword(actor: AuthUser, id: string, password: string): Promise<void> {
  const current = await findDirectoryUserById(id);
  if (!current) throw new AppError('User not found.', 404);
  await writeDirectoryPassword(current.id, password);
}

export { isClientApiConfigured };
