import { query, queryOne } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import type { AuthUser } from '../types/index.js';

export async function listEvents(user: AuthUser, filters: { q?: string; from?: string; to?: string }) {
  const where = ['b.DeletedAt IS NULL', `b.Status NOT IN (N'DRAFT', N'REJECTED')`];
  const inputs: Record<string, unknown> = { UserId: user.id };
  if (!user.permissions.includes('bookings.view_all') && !user.permissions.includes('events.manage')) {
    where.push('b.OrganizerId = @UserId');
  }
  if (filters.q) {
    where.push(`(b.EventName LIKE @Q OR h.Name LIKE @Q)`);
    inputs.Q = `%${filters.q}%`;
  }
  if (filters.from) {
    where.push('b.EndAt >= @From');
    inputs.From = new Date(filters.from);
  }
  if (filters.to) {
    where.push('b.StartAt <= @To');
    inputs.To = new Date(filters.to);
  }
  return query(
    `SELECT e.Id, e.BookingId, e.Description, e.ExpectedAttendees, e.ActualAttendees, e.Requirements,
            b.EventName, b.EventType, b.StartAt, b.EndAt, b.Status, b.AttendeeCount,
            h.Name AS HallName, h.Code AS HallCode, d.Name AS DepartmentName,
            CONCAT(o.FirstName, ' ', o.LastName) AS OrganizerName, o.Phone AS Contact
     FROM dbo.events e
     JOIN dbo.bookings b ON b.Id = e.BookingId
     JOIN dbo.conference_halls h ON h.Id = b.HallId
     JOIN dbo.departments d ON d.Id = b.DepartmentId
     JOIN dbo.users o ON o.Id = b.OrganizerId
     WHERE ${where.join(' AND ')}
     ORDER BY b.StartAt DESC`,
    inputs,
  );
}

export async function getEvent(id: string) {
  const row = await queryOne(
    `SELECT e.Id, e.BookingId, e.Description, e.ExpectedAttendees, e.ActualAttendees, e.Requirements, e.UpdatedAt,
            b.EventName, b.EventType, b.StartAt, b.EndAt, b.Status, b.Purpose, b.AttendeeCount,
            b.OrganizerId, h.Name AS HallName, h.Code AS HallCode, d.Name AS DepartmentName,
            CONCAT(o.FirstName, ' ', o.LastName) AS OrganizerName, o.Phone AS Contact, o.Email AS OrganizerEmail
     FROM dbo.events e
     JOIN dbo.bookings b ON b.Id = e.BookingId
     JOIN dbo.conference_halls h ON h.Id = b.HallId
     JOIN dbo.departments d ON d.Id = b.DepartmentId
     JOIN dbo.users o ON o.Id = b.OrganizerId
     WHERE e.Id = @Id`,
    { Id: id },
  );
  if (!row) throw new AppError('Event not found.', 404);
  return row;
}

export async function updateEvent(
  user: AuthUser,
  id: string,
  input: { description?: string; expectedAttendees?: number; actualAttendees?: number; requirements?: string },
) {
  const event = (await getEvent(id)) as { OrganizerId: string; BookingId: string };
  const can =
    user.permissions.includes('events.manage') ||
    user.permissions.includes('bookings.view_all') ||
    event.OrganizerId === user.id;
  if (!can) throw new AppError('You cannot update this event.', 403);
  await query(
    `UPDATE dbo.events SET
        Description = COALESCE(@Description, Description),
        ExpectedAttendees = COALESCE(@Expected, ExpectedAttendees),
        ActualAttendees = COALESCE(@Actual, ActualAttendees),
        Requirements = COALESCE(@Requirements, Requirements),
        UpdatedAt = SYSUTCDATETIME(),
        UpdatedBy = @Actor
     WHERE Id = @Id`,
    {
      Id: id,
      Description: input.description ?? null,
      Expected: input.expectedAttendees ?? null,
      Actual: input.actualAttendees ?? null,
      Requirements: input.requirements ?? null,
      Actor: user.id,
    },
  );
  return getEvent(id);
}
