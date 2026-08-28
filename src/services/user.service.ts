import { AppError } from '../utils/AppError.js';
import type { Request } from 'express';
import type { AuthUser, Paged } from '../types/index.js';
import type { UserRow } from '../types/db.js';
import {
  findDirectoryUserById,
  listClientApiUsers,
  mapClientApiUser,
  searchClientApiUsers,
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

export async function getUser(id: string): Promise<UserRow> {
  const directory = await findDirectoryUserById(id);
  if (!directory) throw new AppError('User not found.', 404);
  return mapClientApiUser({
    Id: directory.id,
    UserName: directory.userName,
    Email: directory.email,
    Department: directory.department,
    IsActive: directory.isActive,
  });
}

export async function createUser(
  _actor: AuthUser,
  _input: {
    employeeId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    departmentId?: string;
    designation?: string;
    roleId: string;
    password: string;
  },
  _req: Request,
): Promise<UserRow> {
  throw new AppError('Users are managed in CLIENT_API_LIVE. Set Department = TCS for full access.', 400);
}

export async function updateUser(
  _actor: AuthUser,
  _id: string,
  _input: Partial<{
    firstName: string;
    lastName: string;
    phone: string;
    departmentId: string | null;
    designation: string;
    roleId: string;
    status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  }>,
  _req: Request,
): Promise<UserRow> {
  throw new AppError('Users are managed in CLIENT_API_LIVE. Set Department = TCS for full access.', 400);
}

export async function resetPassword(_actor: AuthUser, _id: string, _password: string): Promise<void> {
  throw new AppError('Passwords are managed in CLIENT_API_LIVE.', 400);
}

export async function searchEmployees(q: string) {
  return searchClientApiUsers(q);
}
