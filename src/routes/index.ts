import { Router } from 'express';
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

router.post('/auth/login', loginLimiter, validateRequest(schema.loginSchema), auth.login);
router.post('/auth/refresh', validateRequest(schema.refreshSchema), auth.refresh);
router.post('/auth/logout', authenticate, auth.logout);
router.get('/auth/me', authenticate, auth.me);

router.get('/users', authenticate, authorize('users.view'), auth.listUsers);
router.get('/users/search', authenticate, auth.searchEmployees);
router.get('/users/:id', authenticate, authorize('users.view'), auth.getUser);
router.post('/users', authenticate, authorize('users.manage'), validateRequest(schema.createUserSchema), auth.createUser);
router.patch('/users/:id', authenticate, authorize('users.manage'), validateRequest(schema.updateUserSchema), auth.updateUser);
router.post('/users/:id/reset-password', authenticate, authorize('users.manage'), auth.resetPassword);

router.get('/roles', authenticate, authorize('users.view', 'roles.manage'), auth.listRoles);
router.get('/roles/:id', authenticate, authorize('roles.manage'), auth.getRole);
router.put('/roles/:id/permissions', authenticate, authorize('roles.manage'), auth.setRolePermissions);
router.get('/permissions', authenticate, authorize('roles.manage'), auth.listPermissions);

router.get('/departments', authenticate, auth.listDepartments);
router.post('/departments', authenticate, authorize('departments.manage'), validateRequest(schema.departmentSchema), auth.createDepartment);
router.patch('/departments/:id', authenticate, authorize('departments.manage'), auth.updateDepartment);
router.delete('/departments/:id', authenticate, authorize('departments.manage'), auth.deleteDepartment);

router.get('/halls', authenticate, authorize('halls.view'), halls.listHalls);
router.get('/halls/:id/availability', authenticate, authorize('halls.view'), halls.availability);
router.get('/halls/:id', authenticate, authorize('halls.view'), halls.getHall);
router.post('/halls', authenticate, authorize('halls.create'), validateRequest(schema.createHallSchema), halls.createHall);
router.patch('/halls/:id', authenticate, authorize('halls.update'), halls.updateHall);
router.delete('/halls/:id', authenticate, authorize('halls.delete'), halls.deleteHall);

router.get('/facilities', authenticate, authorize('halls.view'), halls.listFacilities);
router.post('/facilities', authenticate, authorize('halls.manage_facilities'), halls.createFacility);
router.patch('/facilities/:id', authenticate, authorize('halls.manage_facilities'), halls.updateFacility);
router.delete('/facilities/:id', authenticate, authorize('halls.manage_facilities'), halls.deleteFacility);

router.get('/maintenance', authenticate, authorize('maintenance.view'), halls.listMaintenance);
router.post('/maintenance', authenticate, authorize('maintenance.manage'), validateRequest(schema.maintenanceSchema), halls.createMaintenance);
router.patch('/maintenance/:id', authenticate, authorize('maintenance.manage'), halls.updateMaintenance);

router.get('/bookings', authenticate, authorize('bookings.view'), book.listBookings);
router.get('/bookings/:id/attendees', authenticate, authorize('bookings.view'), book.listAttendees);
router.get('/bookings/:id', authenticate, authorize('bookings.view'), book.getBooking);
router.post('/bookings', authenticate, authorize('bookings.create'), validateRequest(schema.createBookingSchema), book.createBooking);
router.patch('/bookings/:id', authenticate, authorize('bookings.update'), book.updateBooking);
router.post('/bookings/:id/approve', authenticate, authorize('bookings.approve'), book.approveBooking);
router.post('/bookings/:id/reject', authenticate, authorize('bookings.approve'), validateRequest(schema.rejectSchema), book.rejectBooking);
router.post('/bookings/:id/cancel', authenticate, authorize('bookings.cancel'), validateRequest(schema.cancelSchema), book.cancelBooking);
router.delete('/bookings/:id', authenticate, authorize('bookings.cancel'), book.deleteBooking);

router.post(
  '/availability/check',
  authenticate,
  authorize('bookings.create', 'bookings.view', 'halls.view'),
  validateRequest(schema.availabilityCheckSchema),
  avail.check,
);

router.get('/approvals', authenticate, authorize('bookings.approve'), book.listApprovals);
router.get('/calendar', authenticate, authorize('calendar.view'), book.calendar);

router.get('/events', authenticate, authorize('events.view'), book.listEvents);
router.get('/events/:id', authenticate, authorize('events.view'), book.getEvent);
router.patch('/events/:id', authenticate, authorize('events.manage'), validateRequest(schema.eventUpdateSchema), book.updateEvent);

router.get('/dashboard', authenticate, authorize('dashboard.view'), ops.dashboard);
router.get('/display/:hallCode', ops.display);

router.get('/notifications', authenticate, authorize('notifications.view'), ops.listNotifications);
router.patch('/notifications/:id/read', authenticate, ops.readNotification);
router.post('/notifications/read-all', authenticate, ops.readAllNotifications);

router.get('/reports/bookings', authenticate, authorize('reports.view'), ops.reportBookings);
router.get('/reports/utilization', authenticate, authorize('reports.view'), ops.reportUtilization);
router.get('/reports/departments', authenticate, authorize('reports.view'), ops.reportDepartments);
router.get('/reports/cancellations', authenticate, authorize('reports.view'), ops.reportCancellations);
router.get('/reports/peak-hours', authenticate, authorize('reports.view'), ops.reportPeak);
router.get('/reports/export', authenticate, authorize('reports.export'), ops.reportExport);

router.get('/settings', authenticate, authorize('settings.manage'), ops.getSettings);
router.patch('/settings', authenticate, authorize('settings.manage'), validateRequest(schema.settingsSchema), ops.patchSettings);
router.post('/settings/test-mail', authenticate, authorize('settings.manage'), validateRequest(schema.testMailSchema), ops.testMail);
router.get('/audit-logs', authenticate, authorize('audit.view'), ops.auditLogs);
