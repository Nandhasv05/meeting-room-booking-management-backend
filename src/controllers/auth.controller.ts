// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Auth controller
// DATE : 2026-08-26
import type { Request, Response } from 'express';
import { ok } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as auth from '../services/auth.service.js';
import * as users from '../services/user.service.js';
import * as roles from '../services/role.service.js';

/** Login */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const data = await auth.login(req.body.email, req.body.password, req);
  ok(res, data, 'Signed in.');
});

/** Refresh */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const data = await auth.refresh(req.body.refreshToken);
  ok(res, data, 'Token refreshed.');
});

/** Logout */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  await auth.logout(req.user!, req);
  ok(res, null, 'Signed out.');
});

/** Me */
export const me = asyncHandler(async (req: Request, res: Response) => {
  ok(res, req.user, 'Profile loaded.');
});

/** List users */
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const data = await users.listUsers({
    q: String(req.body?.q ?? ''),
    departmentId: req.body?.departmentId as string | undefined,
    roleId: req.body?.roleId as string | undefined,
    status: req.body?.status as string | undefined,
    page: Number(req.body?.page ?? 1),
    pageSize: Number(req.body?.pageSize ?? 20),
  });
  ok(res, data);
});

/** Get user */
export const getUser = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await users.getUser(req.params.id as string));
});

/** Create user */
export const createUser = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await users.createUser(req.user!, req.body, req), 'User created.', 201);
});

/** Update user */
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await users.updateUser(req.user!, req.params.id as string, req.body, req), 'User updated.');
});

/** Reset password */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await users.resetPassword(req.user!, req.params.id as string, req.body.password);
  ok(res, null, 'Password reset.');
});

/** Search employees */
export const searchEmployees = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await users.searchEmployees(String(req.body?.q ?? '')));
});

/** List roles */
export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await roles.listRoles());
});

/** Get role */
export const getRole = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await roles.getRole(req.params.id as string));
});

/** Set role permissions */
export const setRolePermissions = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await roles.setRolePermissions(req.user!, req.params.id as string, req.body.permissionIds));
});

/** List permissions */
export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await roles.listPermissions());
});

/** List departments */
export const listDepartments = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await roles.listDepartments(req.body?.all === true || req.body?.all === 'true'));
});

/** Create department */
export const createDepartment = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await roles.createDepartment(req.user!, req.body), 'Department created.', 201);
});

/** Update department */
export const updateDepartment = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await roles.updateDepartment(req.user!, req.params.id as string, req.body), 'Department updated.');
});

/** Delete department */
export const deleteDepartment = asyncHandler(async (req: Request, res: Response) => {
  await roles.deleteDepartment(req.params.id as string);
  ok(res, null, 'Department removed.');
});
