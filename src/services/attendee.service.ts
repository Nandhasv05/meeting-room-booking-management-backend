import { query } from '../config/database.js';

/** Read-only guest list for a booking. Rows are written when the booking is created. */
export async function listAttendees(bookingId: string) {
  return query(
    `SELECT Id, BookingId, UserId, Name, EmployeeId, Department, Email, Phone, CreatedAt
     FROM dbo.booking_attendees
     WHERE BookingId = @BookingId
     ORDER BY Name`,
    { BookingId: bookingId },
  );
}
