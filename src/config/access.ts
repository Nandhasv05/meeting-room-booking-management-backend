// AUTHOR : NANDHAKUMAR S V
// DATE : 28/08/2026
// DESCRIPTION : CLIENT_API_LIVE department access — TCS = full admin, else employee

export const TCS_DEPARTMENT = 'TCS';
export const FULL_ACCESS_ROLE = 'ADMINISTRATOR';
export const EMPLOYEE_ROLE = 'EMPLOYEE';

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

export function isTcsDepartment(value: unknown): boolean {
  const text = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  return text === TCS_DEPARTMENT;
}

export function roleCodeForDepartment(department: unknown): typeof FULL_ACCESS_ROLE | typeof EMPLOYEE_ROLE {
  return isTcsDepartment(department) ? FULL_ACCESS_ROLE : EMPLOYEE_ROLE;
}

export function roleNameForCode(code: string): string {
  return code === FULL_ACCESS_ROLE ? 'Administrator' : 'Employee';
}

export function accessForDepartment(department: unknown) {
  const roleCode = roleCodeForDepartment(department);
  return {
    roleId: roleCode,
    roleCode,
    roleName: roleNameForCode(roleCode),
    permissions: [...(roleCode === FULL_ACCESS_ROLE ? ADMIN_PERMISSIONS : EMPLOYEE_PERMISSIONS)],
  };
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
