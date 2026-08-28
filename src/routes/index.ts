import { Router } from 'express';
import { cryptoEnvelope } from '../middleware/cryptoEnvelope.js';
import { authenticate, authorize } from '../middleware/authenticate.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import * as schema from '../validators/schemas.js';
import * as auth from '../controllers/auth.controller.js';
import * as halls from '../controllers/hall.controller.js';
import * as book from '../controllers/booking.controller.js';
import * as ops from '../controllers/ops.controller.js';
import * as avail from '../controllers/availability.controller.js';

export const router = Router();

router.use(cryptoEnvelope);

router.post('/auth/login', loginLimiter, validateRequest(schema.loginSchema), auth.login);
router.post('/auth/refresh', validateRequest(schema.refreshSchema), auth.refresh);
router.post('/auth/logout', authenticate, auth.logout);
router.post('/auth/me', authenticate, auth.me);

router.post('/users/search', authenticate, auth.searchEmployees);
router.post('/users/create', authenticate, authorize('users.manage'), validateRequest(schema.createUserSchema), auth.createUser);
router.post('/users/:id/reset-password', authenticate, authorize('users.manage'), auth.resetPassword);
router.post('/users/:id/update', authenticate, authorize('users.manage'), validateRequest(schema.updateUserSchema), auth.updateUser);
router.post('/users/:id', authenticate, authorize('users.view'), auth.getUser);
router.post('/users', authenticate, authorize('users.view'), auth.listUsers);

router.post('/roles/:id/permissions', authenticate, authorize('roles.manage'), auth.setRolePermissions);
router.post('/roles/:id', authenticate, authorize('roles.manage'), auth.getRole);
router.post('/roles', authenticate, authorize('users.view', 'roles.manage'), auth.listRoles);
router.post('/permissions', authenticate, authorize('roles.manage'), auth.listPermissions);

router.post('/departments/create', authenticate, authorize('departments.manage'), validateRequest(schema.departmentSchema), auth.createDepartment);
router.post('/departments/:id/update', authenticate, authorize('departments.manage'), auth.updateDepartment);
router.post('/departments/:id/delete', authenticate, authorize('departments.manage'), auth.deleteDepartment);
router.post('/departments', authenticate, auth.listDepartments);

router.post('/halls/create', authenticate, authorize('halls.create'), validateRequest(schema.createHallSchema), halls.createHall);
router.post('/halls/:id/availability', authenticate, authorize('halls.view'), halls.availability);
router.post('/halls/:id/update', authenticate, authorize('halls.update'), halls.updateHall);
router.post('/halls/:id/delete', authenticate, authorize('halls.delete'), halls.deleteHall);
router.post('/halls/:id', authenticate, authorize('halls.view'), halls.getHall);
router.post('/halls', authenticate, authorize('halls.view'), halls.listHalls);

router.post('/facilities/create', authenticate, authorize('halls.manage_facilities'), halls.createFacility);
router.post('/facilities/:id/update', authenticate, authorize('halls.manage_facilities'), halls.updateFacility);
router.post('/facilities/:id/delete', authenticate, authorize('halls.manage_facilities'), halls.deleteFacility);
router.post('/facilities', authenticate, authorize('halls.view'), halls.listFacilities);

router.post('/maintenance/create', authenticate, authorize('maintenance.manage'), validateRequest(schema.maintenanceSchema), halls.createMaintenance);
router.post('/maintenance/:id/update', authenticate, authorize('maintenance.manage'), halls.updateMaintenance);
router.post('/maintenance', authenticate, authorize('maintenance.view'), halls.listMaintenance);

router.post('/bookings/create', authenticate, authorize('bookings.create'), validateRequest(schema.createBookingSchema), book.createBooking);
router.post('/bookings/:id/attendees', authenticate, authorize('bookings.view'), book.listAttendees);
router.post('/bookings/:id/approve', authenticate, authorize('bookings.approve'), book.approveBooking);
router.post('/bookings/:id/reject', authenticate, authorize('bookings.approve'), validateRequest(schema.rejectSchema), book.rejectBooking);
router.post('/bookings/:id/cancel', authenticate, authorize('bookings.cancel'), validateRequest(schema.cancelSchema), book.cancelBooking);
router.post('/bookings/:id/update', authenticate, authorize('bookings.update'), book.updateBooking);
router.post('/bookings/:id/delete', authenticate, authorize('bookings.cancel'), book.deleteBooking);
router.post('/bookings/:id', authenticate, authorize('bookings.view'), book.getBooking);
router.post('/bookings', authenticate, authorize('bookings.view'), book.listBookings);

router.post(
  '/availability/check',
  authenticate,
  authorize('bookings.create', 'bookings.view', 'halls.view'),
  validateRequest(schema.availabilityCheckSchema),
  avail.check,
);

router.post('/approvals', authenticate, authorize('bookings.approve'), book.listApprovals);
router.post('/calendar', authenticate, authorize('calendar.view'), book.calendar);

router.post('/events/:id/update', authenticate, authorize('events.manage'), validateRequest(schema.eventUpdateSchema), book.updateEvent);
router.post('/events/:id', authenticate, authorize('events.view'), book.getEvent);
router.post('/events', authenticate, authorize('events.view'), book.listEvents);

router.post('/dashboard', authenticate, authorize('dashboard.view'), ops.dashboard);
router.post('/display/:hallCode', ops.display);

router.post('/notifications/read-all', authenticate, ops.readAllNotifications);
router.post('/notifications/:id/read', authenticate, ops.readNotification);
router.post('/notifications', authenticate, authorize('notifications.view'), ops.listNotifications);

router.post('/reports/bookings', authenticate, authorize('reports.view'), ops.reportBookings);
router.post('/reports/utilization', authenticate, authorize('reports.view'), ops.reportUtilization);
router.post('/reports/departments', authenticate, authorize('reports.view'), ops.reportDepartments);
router.post('/reports/cancellations', authenticate, authorize('reports.view'), ops.reportCancellations);
router.post('/reports/peak-hours', authenticate, authorize('reports.view'), ops.reportPeak);
router.post('/reports/export', authenticate, authorize('reports.export'), ops.reportExport);

router.post('/settings/test-mail', authenticate, authorize('settings.manage'), validateRequest(schema.testMailSchema), ops.testMail);
router.post('/settings/update', authenticate, authorize('settings.manage'), validateRequest(schema.settingsSchema), ops.patchSettings);
router.post('/settings', authenticate, authorize('settings.manage'), ops.getSettings);
router.post('/audit-logs', authenticate, authorize('audit.view'), ops.auditLogs);
