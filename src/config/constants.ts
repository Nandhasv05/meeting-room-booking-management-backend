// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Constants for the booking system
// DATE : 2026-08-26
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

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  'PENDING',
  'APPROVED',
  'CONFIRMED',
  'ONGOING',
];

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

export const HALL_STATUSES = [
  'AVAILABLE',
  'BOOKED',
  'OCCUPIED',
  'MAINTENANCE',
  'BLOCKED',
] as const;

export const HALL_TYPES = [
  'BOARDROOM',
  'AUDITORIUM',
  'TRAINING',
  'MEETING',
  'MULTIPURPOSE',
  'CONFERENCE',
] as const;

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
} as const;
