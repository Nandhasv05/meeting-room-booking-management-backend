// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Seed booking system
// DATE : 2026-08-26
import { getPool, query, queryOne, queryOneSoft, querySoft, insert, closePool } from '../config/database.js';
import { logger } from '../config/logger.js';

/** Halls */
const halls = [
  { name: 'Main Conference Hall', code: 'MCH-01', type: 'CONFERENCE', cap: 180, building: 'Tower A', floor: '2', loc: 'Tower A, Level 2' },
  { name: 'Board Room A', code: 'BR-A', type: 'BOARDROOM', cap: 16, building: 'Tower A', floor: '12', loc: 'Executive floor' },
  { name: 'Board Room B', code: 'BR-B', type: 'BOARDROOM', cap: 12, building: 'Tower A', floor: '12', loc: 'Executive floor' },
  { name: 'Training Studio', code: 'TR-01', type: 'TRAINING', cap: 40, building: 'Tower B', floor: '3', loc: 'Learning centre' },
  { name: 'Innovation Lab', code: 'IL-01', type: 'MULTIPURPOSE', cap: 60, building: 'Tower B', floor: '1', loc: 'Campus west' },
  { name: 'Auditorium', code: 'AUD-01', type: 'AUDITORIUM', cap: 220, building: 'Tower C', floor: 'G', loc: 'Campus east' },
];

/** Main */
async function main() {
  await getPool();
  const hallsTable = await queryOne<{ Id: number | null }>(`SELECT OBJECT_ID(N'dbo.conference_halls', N'U') AS Id`);
  if (!hallsTable?.Id) {
    logger.error(
      'dbo.conference_halls is missing. A db_owner must run database/sqlserver/booking_schema.sql then grant_booking_tables.sql.',
    );
    await closePool();
    process.exit(1);
  }
  const contact = await queryOne<{ Id: string }>(`SELECT TOP (1) CAST(Id AS nvarchar(64)) AS Id FROM dbo.users ORDER BY UserName`);
  const facilities = await querySoft<{ Id: string; Code: string }>(`SELECT Id, Code FROM dbo.facilities`);

  for (const h of halls) {
    const exists = await queryOneSoft(`SELECT Id FROM dbo.conference_halls WHERE Code = @Code`, { Code: h.code });
    if (exists) continue;
    const id = await insert(
      `INSERT INTO dbo.conference_halls
        (Name, Code, Description, Location, Building, Floor, Capacity, HallType, Status, OpeningTime, ClosingTime, ContactPersonId, IsActive, CreatedBy)
       VALUES
        (@Name, @Code, @Desc, @Loc, @Building, @Floor, @Cap, @Type, N'AVAILABLE', '08:00', '20:00', @Contact, 1, @Actor)`,
      {
        Name: h.name,
        Code: h.code,
        Desc: `${h.name} for corporate meetings and events.`,
        Loc: h.loc,
        Building: h.building,
        Floor: h.floor,
        Cap: h.cap,
        Type: h.type,
        Contact: contact?.Id ?? null,
        Actor: contact?.Id ?? null,
      },
    );
    const pick = facilities.filter((f) =>
      ['WIFI', 'AC', 'PROJECTOR', 'VIDEO_CONFERENCING', 'MICROPHONE'].includes(f.Code),
    );
    for (const f of pick) {
      await query(`INSERT INTO dbo.hall_facilities (HallId, FacilityId) VALUES (@HallId, @FacilityId)`, {
        HallId: id,
        FacilityId: f.Id,
      });
    }
    await insert(
      `INSERT INTO dbo.hall_seating_layouts (HallId, Name, Capacity, IsDefault)
       VALUES (@HallId, N'Theatre', @Cap, 1)`,
      { HallId: id, Cap: h.cap },
    );
    logger.info({ code: h.code }, 'seeded hall');
  }

  await seedDemoBooking(contact?.Id ?? null);

  logger.info('Seed complete. Sign in with a CLIENT_API_LIVE dbo.users username.');
  await closePool();
}

async function seedDemoBooking(actorId: string | null) {
  const exists = await queryOne(`SELECT Id FROM dbo.bookings WHERE BookingNumber = N'BK-DEMO-001' AND DeletedAt IS NULL`);
  if (exists) {
    logger.info('demo booking BK-DEMO-001 already present');
    return;
  }
  const hall = await queryOne<{ Id: string }>(`SELECT TOP (1) Id FROM dbo.conference_halls WHERE Code = N'MCH-01' AND DeletedAt IS NULL`);
  const dept = await queryOne<{ Id: string }>(
    `SELECT TOP (1) Id FROM dbo.departments WHERE DeletedAt IS NULL ORDER BY CASE WHEN Code = N'TCS' THEN 0 ELSE 1 END, Id`,
  );
  const layout = await queryOne<{ Id: string }>(
    `SELECT TOP (1) Id FROM dbo.hall_seating_layouts WHERE HallId = @HallId ORDER BY IsDefault DESC`,
    { HallId: hall?.Id ?? null },
  );
  if (!hall || !dept || !actorId) {
    logger.warn('skip demo booking — need a hall, department, and dbo.users row');
    return;
  }
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12, 0, 0, 0);
  const bookingId = await insert(
    `INSERT INTO dbo.bookings (
        BookingNumber, EventName, EventType, DepartmentId, OrganizerId, ContactEmail, HallId,
        BookingDate, StartAt, EndAt, AttendeeCount, SeatingLayoutId, Purpose, CateringRequired,
        Status, QrToken, RequiresApproval, CreatedBy, UpdatedBy
      ) VALUES (
        N'BK-DEMO-001', N'Sample team standup', N'MEETING', @DepartmentId, @OrganizerId, N'saideep@evolvclothing.com', @HallId,
        CAST(@StartAt AS DATE), @StartAt, @EndAt, 8, @LayoutId, N'Demo booking for full-flow testing.', 0,
        N'CONFIRMED', N'demo-qr-bk-001', 0, @Actor, @Actor
      )`,
    {
      DepartmentId: dept.Id,
      OrganizerId: actorId,
      HallId: hall.Id,
      StartAt: start,
      EndAt: end,
      LayoutId: layout?.Id ?? null,
      Actor: actorId,
    },
  );
  await insert(
    `INSERT INTO dbo.events (BookingId, Description, ExpectedAttendees) VALUES (@BookingId, N'Demo booking for full-flow testing.', 8)`,
    { BookingId: bookingId },
  );
  await query(
    `INSERT INTO dbo.booking_status_history (BookingId, FromStatus, ToStatus, Comment, ActorId)
     VALUES (@BookingId, NULL, N'CONFIRMED', N'Sample seed', @Actor)`,
    { BookingId: bookingId, Actor: actorId },
  );
  await query(
    `INSERT INTO dbo.booking_attendees (BookingId, Name, Email, Department, AttendanceStatus)
     VALUES (@BookingId, N'Admin', N'saideep@evolvclothing.com', N'TCS', N'INVITED'),
            (@BookingId, N'Geetha', N'vgeetha@evolvclothing.com', N'HR', N'INVITED')`,
    { BookingId: bookingId },
  );
  logger.info({ bookingId, number: 'BK-DEMO-001' }, 'seeded demo booking');
}

/** Catch */
main().catch((err) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
