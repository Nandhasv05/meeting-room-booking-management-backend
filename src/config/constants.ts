// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Constants for the booking system
// DATE : 2026-08-26
// DESCRIPTION : Constants for the booking system
/** Booking statuses */
export const BOOKING_STATUSES = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CONFIRMED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Active booking statuses */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  'PENDING',
  'APPROVED',
  'CONFIRMED',
  'ONGOING',
];

/** Event types */
export const EVENT_TYPES = [
  'MEETING',
  'CONFERENCE',
  'SEMINAR',
  'TRAINING',
  'WORKSHOP',
  'PRESENTATION',
  'CLIENT_MEETING',
  'CORPORATE_EVENT',
  'OTHER',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Hall statuses */
export const HALL_STATUSES = [
  'AVAILABLE',
  'BOOKED',
  'OCCUPIED',
  'MAINTENANCE',
  'BLOCKED',
] as const;

/** Hall types */
export const HALL_TYPES = [
  'BOARDROOM',
  'AUDITORIUM',
  'TRAINING',
  'MEETING',
  'MULTIPURPOSE',
  'CONFERENCE',
] as const;

/** Socket events */
export const SOCKET_EVENTS = {
  BOOKING_CREATED: 'booking.created',
  BOOKING_UPDATED: 'booking.updated',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_DELETED: 'booking.deleted',
  BOOKING_APPROVED: 'booking.approved',
  BOOKING_STARTED: 'booking.started',
  BOOKING_COMPLETED: 'booking.completed',
  HALL_STATUS: 'hall.status.updated',
  HALL_MAINTENANCE: 'hall.maintenance.updated',
  NOTIFICATION: 'notification.created',
} as const;

/** Audit actions */
export const AUDIT_ACTIONS = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  BOOKING_CREATED: 'Booking Created',
  BOOKING_UPDATED: 'Booking Updated',
  BOOKING_CANCELLED: 'Booking Cancelled',
  BOOKING_DELETED: 'Booking Deleted',
  BOOKING_APPROVED: 'Booking Approved',
  BOOKING_REJECTED: 'Booking Rejected',
  HALL_CREATED: 'Hall Created',
  HALL_UPDATED: 'Hall Updated',
  HALL_DELETED: 'Hall Deleted',
  MAINTENANCE_CREATED: 'Maintenance Created',
  USER_CREATED: 'User Created',
  ROLE_CHANGED: 'Role Changed',
  UNAUTHORIZED: 'Unauthorized',
} as const;
