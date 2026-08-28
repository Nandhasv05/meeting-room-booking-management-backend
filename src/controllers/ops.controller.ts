// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Ops controller
// DATE : 2026-08-26
import type { Request, Response } from 'express';
import { ok } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getDashboard } from '../services/dashboard.service.js';
import { getDisplay } from '../services/display.service.js';
import * as reports from '../services/report.service.js';
import * as notif from '../services/notification.service.js';
import * as mail from '../services/email.service.js';
import * as settings from '../services/settings.service.js';
import * as audit from '../services/audit.service.js';

/** Dashboard */
export const dashboard = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await getDashboard());
});

/** Display */
export const display = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await getDisplay(req.params.hallCode as string));
});

/** Report bookings */
export const reportBookings = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.bookingReport((req.body ?? {}) as Record<string, string>));
});

/** Report utilization */
export const reportUtilization = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.utilizationReport((req.body ?? {}) as Record<string, string>));
});

/** Report departments */
export const reportDepartments = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.departmentReport((req.body ?? {}) as Record<string, string>));
});

/** Report cancellations */
export const reportCancellations = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.cancellationReport((req.body ?? {}) as Record<string, string>));
});

/** Report peak */
export const reportPeak = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.peakHoursReport((req.body ?? {}) as Record<string, string>));
});

/** Report export */
export const reportExport = asyncHandler(async (req: Request, res: Response) => {
  const filters = (req.body ?? {}) as Record<string, string>;
  await reports.exportReport(String(filters.type), String(filters.format ?? 'xlsx'), filters, res);
});

/** List notifications */
export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const items = await notif.listNotifications(req.user!, req.body?.unread === true || req.body?.unread === 'true');
  const unread = await notif.unreadCount(req.user!);
  ok(res, { items, unread });
});

/** Read notification */
export const readNotification = asyncHandler(async (req: Request, res: Response) => {
  await notif.markRead(req.user!, req.params.id as string);
  ok(res, null, 'Marked read.');
});

/** Read all notifications */
export const readAllNotifications = asyncHandler(async (req: Request, res: Response) => {
  await notif.markAllRead(req.user!);
  ok(res, null, 'All notifications marked read.');
});

/** List settings */
export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await settings.listSettings());
});

/** Patch settings */
export const patchSettings = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await settings.updateSettings(req.user!.id, req.body.entries), 'Settings saved.');
});

/** Test mail */
export const testMail = asyncHandler(async (req: Request, res: Response) => {
  await mail.sendTestMail(String(req.body.to));
  ok(res, null, `Test mail sent to ${req.body.to}.`);
});

/** Audit logs */
export const auditLogs = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await audit.listAuditLogs({
      q: req.body?.q as string | undefined,
      module: req.body?.module as string | undefined,
      from: req.body?.from as string | undefined,
      to: req.body?.to as string | undefined,
      page: Number(req.body?.page ?? 1),
      pageSize: Number(req.body?.pageSize ?? 30),
    }),
  );
});
