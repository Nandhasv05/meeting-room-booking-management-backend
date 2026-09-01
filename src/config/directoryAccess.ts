// dbo.users access helpers — kept in this file so the API builds even when
// an older src/config/access.ts is still on the PHP server.
export const TCS_DEPARTMENT = 'TCS';
export const FULL_ACCESS_ROLE = 'ADMINISTRATOR';
export const EMPLOYEE_ROLE = 'EMPLOYEE';

const ADMIN_ROLE_KEYS = new Set([
  'ADMIN',
  'SUPERADMIN',
  'ADMINISTRATOR',
  'SUPER',
  'SUPERADMINISTRATOR',
  'ITADMIN',
]);

export const EMPLOYEE_PERMISSIONS = [
  'dashboard.view',
  'halls.view',
  'bookings.view',
  'bookings.create',
  'bookings.update',
  'bookings.cancel',
  'calendar.view',
  'events.view',
  'attendees.view',
  'checkin.perform',
  'notifications.view',
  'display.view',
] as const;

export const ADMIN_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  'halls.create',
  'halls.update',
  'halls.delete',
  'halls.manage_facilities',
  'bookings.view_all',
  'bookings.approve',
  'events.manage',
  'attendees.manage',
  'reports.view',
  'reports.export',
  'users.view',
  'users.manage',
  'roles.manage',
  'departments.manage',
  'settings.manage',
  'audit.view',
  'maintenance.view',
  'maintenance.manage',
] as const;

function compactUpper(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

export function isTcsDepartment(value: unknown): boolean {
  return compactUpper(value) === TCS_DEPARTMENT;
}

export function isAdminFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value ?? '')
    .trim()
    .toUpperCase();
  return ['1', 'TRUE', 'YES', 'Y'].includes(text);
}

export function isAdminRoleName(role: unknown): boolean {
  return ADMIN_ROLE_KEYS.has(compactUpper(role));
}

export type DirectoryAccessInput = {
  role?: unknown;
  isAdmin?: unknown;
  department?: unknown;
};

export function isDirectoryAdmin(input: DirectoryAccessInput): boolean {
  return isAdminFlag(input.isAdmin) || isAdminRoleName(input.role) || isTcsDepartment(input.department);
}

export const DIRECTORY_ADMIN_SQL = `(
  ISNULL(TRY_CONVERT(int, IsAdmin), 0) = 1
  OR UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(Role, N''))), N' ', N''), N'_', N''), N'.', N''))
      IN (N'ADMIN', N'SUPERADMIN', N'ADMINISTRATOR', N'SUPER', N'SUPERADMINISTRATOR', N'ITADMIN')
  OR UPPER(LTRIM(RTRIM(ISNULL(Department, N'')))) = N'TCS'
)`;

export function roleCodeForDepartment(department: unknown): typeof FULL_ACCESS_ROLE | typeof EMPLOYEE_ROLE {
  return isTcsDepartment(department) ? FULL_ACCESS_ROLE : EMPLOYEE_ROLE;
}

export function roleCodeForDirectoryUser(input: DirectoryAccessInput): typeof FULL_ACCESS_ROLE | typeof EMPLOYEE_ROLE {
  return isDirectoryAdmin(input) ? FULL_ACCESS_ROLE : EMPLOYEE_ROLE;
}

export function roleNameForCode(code: string): string {
  return code === FULL_ACCESS_ROLE ? 'Administrator' : 'Employee';
}

export function accessForDirectoryUser(input: DirectoryAccessInput) {
  const roleCode = roleCodeForDirectoryUser(input);
  return {
    roleId: roleCode,
    roleCode,
    roleName: roleNameForCode(roleCode),
    permissions: [...(roleCode === FULL_ACCESS_ROLE ? ADMIN_PERMISSIONS : EMPLOYEE_PERMISSIONS)],
  };
}

export function accessForDepartment(department: unknown) {
  return accessForDirectoryUser({ department });
}

export async function loadPermissionsByRoleCode(roleCode: string) {
  const code = roleCode === FULL_ACCESS_ROLE ? FULL_ACCESS_ROLE : EMPLOYEE_ROLE;
  return {
    roleId: code,
    roleCode: code,
    roleName: roleNameForCode(code),
    permissions: [...(code === FULL_ACCESS_ROLE ? ADMIN_PERMISSIONS : EMPLOYEE_PERMISSIONS)],
  };
}
