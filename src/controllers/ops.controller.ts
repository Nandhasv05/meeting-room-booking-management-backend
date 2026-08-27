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

export const dashboard = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await getDashboard());
});

export const display = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await getDisplay(req.params.hallCode as string));
});

export const reportBookings = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.bookingReport(req.query as Record<string, string>));
});

export const reportUtilization = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.utilizationReport(req.query as Record<string, string>));
});

export const reportDepartments = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.departmentReport(req.query as Record<string, string>));
});

export const reportCancellations = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.cancellationReport(req.query as Record<string, string>));
});

export const reportPeak = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await reports.peakHoursReport(req.query as Record<string, string>));
});

export const reportExport = asyncHandler(async (req: Request, res: Response) => {
  await reports.exportReport(String(req.query.type), String(req.query.format ?? 'xlsx'), req.query as Record<string, string>, res);
});

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const items = await notif.listNotifications(req.user!, req.query.unread === 'true');
  const unread = await notif.unreadCount(req.user!);
  ok(res, { items, unread });
});

export const readNotification = asyncHandler(async (req: Request, res: Response) => {
  await notif.markRead(req.user!, req.params.id as string);
  ok(res, null, 'Marked read.');
});

export const readAllNotifications = asyncHandler(async (req: Request, res: Response) => {
  await notif.markAllRead(req.user!);
  ok(res, null, 'All notifications marked read.');
});

export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await settings.listSettings());
});

export const patchSettings = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await settings.updateSettings(req.user!.id, req.body.entries), 'Settings saved.');
});

export const testMail = asyncHandler(async (req: Request, res: Response) => {
  await mail.sendTestMail(String(req.body.to));
  ok(res, null, `Test mail sent to ${req.body.to}.`);
});

export const auditLogs = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await audit.listAuditLogs({
      q: req.query.q as string | undefined,
      module: req.query.module as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 30),
    }),
  );
});
