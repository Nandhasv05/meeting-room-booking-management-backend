import type { Request, Response } from 'express';
import { ok, created } from '../utils/apiResponse.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as bookings from '../services/booking.service.js';
import * as events from '../services/event.service.js';
import * as attendees from '../services/attendee.service.js';

export const listBookings = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await bookings.listBookings(req.user!, {
      tab: req.query.tab as string | undefined,
      hallId: req.query.hallId as string | undefined,
      status: req.query.status as string | undefined,
      departmentId: req.query.departmentId as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      q: req.query.q as string | undefined,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
    }),
  );
});

export const getBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.getBookingById(req.params.id as string, req.user!));
});

export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  created(res, await bookings.createBooking(req.user!, req.body, req), 'Booking created successfully.');
});

export const updateBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.updateBooking(req.user!, req.params.id as string, req.body, req), 'Booking updated.');
});

export const approveBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.approveBooking(req.user!, req.params.id as string, req.body.comment, req), 'Booking approved.');
});

export const rejectBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.rejectBooking(req.user!, req.params.id as string, req.body.reason, req), 'Booking rejected.');
});

export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await bookings.cancelBooking(req.user!, req.params.id as string, req.body.reason, req), 'Booking cancelled.');
});

export const deleteBooking = asyncHandler(async (req: Request, res: Response) => {
  await bookings.deleteBooking(req.user!, req.params.id as string, req);
  ok(res, null, 'Booking deleted.');
});

export const listApprovals = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await bookings.listApprovals());
});

export const calendar = asyncHandler(async (req: Request, res: Response) => {
  ok(
    res,
    await bookings.calendarEvents(String(req.query.from), String(req.query.to), req.query.hallId as string | undefined),
  );
});

export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await events.listEvents(req.user!, req.query as Record<string, string>));
});

export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await events.getEvent(req.params.id as string));
});

export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await events.updateEvent(req.user!, req.params.id as string, req.body), 'Event updated.');
});

export const listAttendees = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await attendees.listAttendees(req.params.id as string));
});

