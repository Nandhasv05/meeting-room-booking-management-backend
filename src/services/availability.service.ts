// AUTHOR : NANDHAKUMAR S V
//VERSION : 1.0.0
//DESCRIPTION : Free/busy lookups for halls and employees before a booking is created
// DATE : 2026-08-26
import { query, queryOne } from '../config/database.js';

export type SlotConflict = {
  Id: string;
  BookingNumber: string;
  EventName: string;
  StartAt: string;
  EndAt: string;
  Status: string;
  HallName: string;
};

export type HallAvailability = {
  hallId: string;
  hallName: string;
  capacity: number;
  openingTime: string;
  closingTime: string;
  available: boolean;
  blockers: string[];
  conflicts: SlotConflict[];
  maintenance: { Id: string; Title: string; StartAt: string; EndAt: string }[];
};

export type PersonAvailability = {
  userId: string;
  name: string;
  email: string;
  employeeId: string | null;
  department: string | null;
  available: boolean;
  conflicts: SlotConflict[];
};

export type AvailabilityInput = {
  hallId?: string;
  userIds?: string[];
  startAt: string;
  endAt: string;
  attendeeCount?: number;
  excludeBookingId?: string;
};

/** Statuses that still hold a slot. Cancelled/rejected bookings free the room. */
const HOLDS_SLOT = `Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT', N'NO_SHOW')`;

function clock(d: Date) {
  return d.toTimeString().slice(0, 8);
}

async function hallAvailability(
  hallId: string,
  startAt: Date,
  endAt: Date,
  attendeeCount?: number,
  excludeBookingId?: string,
): Promise<HallAvailability | null> {
  const hall = await queryOne<{
    Id: string;
    Name: string;
    Capacity: number;
    Status: string;
    IsActive: boolean;
    OpeningTime: string;
    ClosingTime: string;
  }>(
    `SELECT Id, Name, Capacity, Status, IsActive,
            CONVERT(varchar(8), OpeningTime, 108) AS OpeningTime,
            CONVERT(varchar(8), ClosingTime, 108) AS ClosingTime
     FROM dbo.conference_halls
     WHERE Id = @Id AND DeletedAt IS NULL`,
    { Id: hallId },
  );
  if (!hall) return null;

  const conflicts = await query<SlotConflict>(
    `SELECT b.Id, b.BookingNumber, b.EventName, b.StartAt, b.EndAt, b.Status, h.Name AS HallName
     FROM dbo.bookings b
     JOIN dbo.conference_halls h ON h.Id = b.HallId
     WHERE b.HallId = @HallId
       AND b.DeletedAt IS NULL
       AND b.${HOLDS_SLOT}
       AND b.StartAt < @EndAt
       AND b.EndAt > @StartAt
       AND (@ExcludeBookingId IS NULL OR b.Id <> @ExcludeBookingId)
     ORDER BY b.StartAt`,
    { HallId: hallId, StartAt: startAt, EndAt: endAt, ExcludeBookingId: excludeBookingId ?? null },
  );

  const maintenance = await query<{ Id: string; Title: string; StartAt: string; EndAt: string }>(
    `SELECT Id, Title, StartAt, EndAt
     FROM dbo.hall_maintenance
     WHERE HallId = @HallId
       AND DeletedAt IS NULL
       AND Status IN (N'SCHEDULED', N'IN_PROGRESS')
       AND StartAt < @EndAt
       AND EndAt > @StartAt`,
    { HallId: hallId, StartAt: startAt, EndAt: endAt },
  );

  const blockers: string[] = [];
  if (!hall.IsActive) blockers.push('Hall is inactive.');
  if (hall.Status === 'BLOCKED') blockers.push('Hall is blocked.');
  if (conflicts.length) {
    blockers.push(`Already booked: ${conflicts[0]?.EventName ?? 'another event'}.`);
  }
  if (maintenance.length) blockers.push('Under maintenance for this window.');
  if (clock(startAt) < hall.OpeningTime || clock(endAt) > hall.ClosingTime) {
    blockers.push(`Outside hall hours ${hall.OpeningTime.slice(0, 5)}–${hall.ClosingTime.slice(0, 5)}.`);
  }
  if (attendeeCount && attendeeCount > hall.Capacity) {
    blockers.push(`Attendees exceed capacity (${hall.Capacity}).`);
  }

  return {
    hallId: hall.Id,
    hallName: hall.Name,
    capacity: hall.Capacity,
    openingTime: hall.OpeningTime,
    closingTime: hall.ClosingTime,
    available: blockers.length === 0,
    blockers,
    conflicts,
    maintenance,
  };
}

async function peopleAvailability(
  userIds: string[],
  startAt: Date,
  endAt: Date,
  excludeBookingId?: string,
): Promise<PersonAvailability[]> {
  const people = await query<{
    Id: string;
    FirstName: string;
    LastName: string;
    Email: string;
    EmployeeId: string | null;
    DepartmentName: string | null;
  }>(
    `SELECT u.Id, u.FirstName, u.LastName, u.Email, u.EmployeeId, d.Name AS DepartmentName
     FROM dbo.users u
     LEFT JOIN dbo.departments d ON d.Id = u.DepartmentId
     WHERE u.Id IN (@UserIds) AND u.DeletedAt IS NULL`,
    { UserIds: userIds },
  );
  if (!people.length) return [];

  const busy = await query<SlotConflict & { UserId: string }>(
    `SELECT DISTINCT u.Id AS UserId, b.Id, b.BookingNumber, b.EventName, b.StartAt, b.EndAt, b.Status,
            h.Name AS HallName
     FROM dbo.users u
     JOIN dbo.bookings b
       ON b.DeletedAt IS NULL
      AND b.${HOLDS_SLOT}
      AND b.StartAt < @EndAt
      AND b.EndAt > @StartAt
      AND (
        b.OrganizerId = u.Id
        OR EXISTS (
          SELECT 1 FROM dbo.booking_attendees a
          WHERE a.BookingId = b.Id
            AND (a.UserId = u.Id OR (a.Email IS NOT NULL AND a.Email = u.Email))
        )
      )
     JOIN dbo.conference_halls h ON h.Id = b.HallId
     WHERE u.Id IN (@UserIds)
       AND (@ExcludeBookingId IS NULL OR b.Id <> @ExcludeBookingId)
     ORDER BY b.StartAt`,
    { UserIds: userIds, StartAt: startAt, EndAt: endAt, ExcludeBookingId: excludeBookingId ?? null },
  );

  return people.map((u) => {
    const conflicts = busy.filter((row) => row.UserId === u.Id);
    return {
      userId: u.Id,
      name: `${u.FirstName} ${u.LastName}`.trim(),
      email: u.Email,
      employeeId: u.EmployeeId,
      department: u.DepartmentName,
      available: conflicts.length === 0,
      conflicts,
    };
  });
}

export async function checkAvailability(input: AvailabilityInput) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const [hall, people] = await Promise.all([
    input.hallId
      ? hallAvailability(input.hallId, startAt, endAt, input.attendeeCount, input.excludeBookingId)
      : Promise.resolve(null),
    input.userIds?.length
      ? peopleAvailability(input.userIds, startAt, endAt, input.excludeBookingId)
      : Promise.resolve([] as PersonAvailability[]),
  ]);
  return { hall, people };
}
