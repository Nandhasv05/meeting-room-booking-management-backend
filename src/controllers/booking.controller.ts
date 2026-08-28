// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Booking controller
// DATE : 2026-08-26
import type { Request, Response } from 'express';
import { ok, created } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as bookings from '../services/booking.service.js';
import * as events from '../services/event.service.js';
import * as attendees from '../services/attendee.service.js';

/** List bookings */
export const listBookings = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await bookings.listBookings(req.user!, {
      tab: req.body?.tab as string | undefined,
      hallId: req.body?.hallId as string | undefined,
      status: req.body?.status as string | undefined,
      departmentId: req.body?.departmentId as string | undefined,
      from: req.body?.from as string | undefined,
      to: req.body?.to as string | undefined,
      q: req.body?.q as string | undefined,
      page: Number(req.body?.page ?? 1),
      pageSize: Number(req.body?.pageSize ?? 20),
    }),
  );
});

/** Get booking */
export const getBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.getBookingById(req.params.id as string, req.user!));
});

/** Create booking */
export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  created(res, await bookings.createBooking(req.user!, req.body, req), 'Booking created successfully.');
});

/** Update booking */
export const updateBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.updateBooking(req.user!, req.params.id as string, req.body, req), 'Booking updated.');
});

/** Approve booking */
export const approveBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.approveBooking(req.user!, req.params.id as string, req.body.comment, req), 'Booking approved.');
});

/** Reject booking */
export const rejectBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.rejectBooking(req.user!, req.params.id as string, req.body.reason, req), 'Booking rejected.');
});

/** Cancel booking */
export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.cancelBooking(req.user!, req.params.id as string, req.body.reason, req), 'Booking cancelled.');
});

/** Delete booking */
export const deleteBooking = asyncHandler(async (req: Request, res: Response) => {
  await bookings.deleteBooking(req.user!, req.params.id as string, req);
  ok(res, null, 'Booking deleted.');
});

/** List approvals */
export const listApprovals = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await bookings.listApprovals());
});

/** Calendar */
export const calendar = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await bookings.calendarEvents(String(req.body?.from ?? ''), String(req.body?.to ?? ''), req.body?.hallId as string | undefined),
  );
});

/** List events */
export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await events.listEvents(req.user!, (req.body ?? {}) as Record<string, string>));
});

/** Get event */
export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await events.getEvent(req.params.id as string));
});

/** Update event */
export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await events.updateEvent(req.user!, req.params.id as string, req.body), 'Event updated.');
});

/** List attendees */
export const listAttendees = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await attendees.listAttendees(req.params.id as string));
});

