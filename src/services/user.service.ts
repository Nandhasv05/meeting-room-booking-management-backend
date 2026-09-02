import { AppError } from '../utils/AppError.js';
import type { Request } from 'express';
import type { AuthUser, Paged } from '../types/index.js';
import type { UserRow } from '../types/db.js';
import {
  createDirectoryUser,
  findDirectoryUserById,
  listClientApiUsers,
  mapClientApiUser,
  readRevealablePassword,
  resetDirectoryPassword,
  searchClientApiUsers,
  updateDirectoryUser,
} from './clientApiUsers.js';

export async function listUsers(filters: {
  q?: string;
  departmentId?: string;
  roleId?: string;
  status?: string;
  page: number;
  pageSize: number;
}): Promise<Paged<UserRow>> {
  return listClientApiUsers(filters);
}

export async function getUser(actor: AuthUser, id: string): Promise<UserRow & { CurrentPassword?: string }> {
  const directory = await findDirectoryUserById(id);
  if (!directory) throw new AppError('User not found.', 404);
  const mapped = mapClientApiUser({
    Id: directory.id,
    UserName: directory.userName,
    Email: directory.email,
    Department: directory.department,
    IsActive: directory.isActive,
    Role: directory.role,
    IsAdmin: directory.isAdmin,
  });
  if (!actor.permissions.includes('users.manage')) return mapped;
  const currentPassword = await readRevealablePassword(directory.id);
  return currentPassword ? { ...mapped, CurrentPassword: currentPassword } : mapped;
}

export async function createUser(
  actor: AuthUser,
  input: {
    employeeId: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    department?: string;
    departmentId?: string;
    designation?: string;
    roleId: string;
    password: string;
    status?: 'ACTIVE' | 'DISABLED';
  },
  _req: Request,
): Promise<UserRow> {
  return createDirectoryUser(actor, input);
}

export async function updateUser(
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
  _req: Request,
): Promise<UserRow> {
  return updateDirectoryUser(actor, id, input);
}

export async function resetPassword(actor: AuthUser, id: string, password: string): Promise<void> {
  await resetDirectoryPassword(actor, id, password);
}

export async function searchEmployees(q: string) {
  return searchClientApiUsers(q);
}
