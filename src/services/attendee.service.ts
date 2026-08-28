// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Attendee service
// DATE : 2026-08-26
import { query } from '../config/database.js';

/** List attendees */
export async function listAttendees(bookingId: string) {
  return query(
    `SELECT Id, BookingId, UserId, Name, EmployeeId, Department, Email, Phone, CreatedAt
     FROM dbo.booking_attendees
     WHERE BookingId = @BookingId
     ORDER BY Name`,
    { BookingId: bookingId },
  );
}
