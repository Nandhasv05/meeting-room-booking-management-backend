import { query, queryOne, txQuery, txQueryOne, txInsert, withTransaction, sql, type DbTx } from '../config/database.js';
import { AppError, ConflictError } from '../utils/AppError.js';
import { bookingNumber, newQrToken } from '../utils/ids.js';
import { writeAudit } from '../middleware/auditLogger.js';
import { AUDIT_ACTIONS, SOCKET_EVENTS } from '../config/constants.js';
import { getIo } from '../sockets/registry.js';
import { notify, notifyMany } from './notification.service.js';
import { sendCancellationCard, sendMeetingInvites, type InvitationCard } from './email.service.js';
import { BOOKING_SELECT, omitQr, type BookingRow } from '../types/db.js';
import type { AuthUser, Paged } from '../types/index.js';
import type { Request } from 'express';

type ConflictRow = { Id: string; BookingNumber: string; EventName: string; StartAt: Date; EndAt: Date; Status: string };

function emit(event: string, payload: Record<string, unknown>) {
  const io = getIo();
  if (!io) return;
  io.emit(event, payload);
  if (typeof payload.hallCode === 'string') {
    io.to(`hall:${payload.hallCode}`).emit(event, payload);
  }
  io.to('dashboard').emit(event, payload);
  io.to('calendar').emit(event, payload);
}

async function getBooking(id: string): Promise<BookingRow> {
  const row = await queryOne<BookingRow>(
    `${BOOKING_SELECT} WHERE b.Id = @Id AND b.DeletedAt IS NULL`,
    { Id: id },
  );
  if (!row) throw new AppError('Booking not found.', 404);
  return row;
}

export async function getBookingById(id: string, user: AuthUser) {
  const booking = await getBooking(id);
  assertCanView(user, booking);
  const { QrToken: _qr, ...safe } = booking;
  const facilities = await query<{ Id: string; Code: string; Name: string }>(
    `SELECT f.Id, f.Code, f.Name FROM dbo.booking_facilities bf
     JOIN dbo.facilities f ON f.Id = bf.FacilityId WHERE bf.BookingId = @Id`,
    { Id: id },
  );
  const history = await query(
    `SELECT h.Id, h.FromStatus, h.ToStatus, h.Comment, h.CreatedAt,
            CONCAT(u.FirstName, ' ', u.LastName) AS ActorName
     FROM dbo.booking_status_history h
     LEFT JOIN dbo.users u ON u.Id = h.ActorId
     WHERE h.BookingId = @Id
     ORDER BY h.CreatedAt`,
    { Id: id },
  );
  return { ...safe, facilities, history };
}

function assertCanView(user: AuthUser, booking: BookingRow) {
  if (user.permissions.includes('bookings.view_all') || booking.OrganizerId === user.id) return;
  throw new AppError('You cannot view this booking.', 403);
}

function canManage(user: AuthUser, booking: Pick<BookingRow, 'OrganizerId'>) {
  return user.permissions.includes('bookings.view_all') || booking.OrganizerId === user.id;
}

export type CreateBookingInput = {
  eventName: string;
  eventType: string;
  departmentId: string;
  organizerId?: string;
  contactNumber?: string;
  mailId?: string;
  invitationEmails?: string[];
  hallId: string;
  startAt: string;
  endAt: string;
  attendeeCount: number;
  seatingLayoutId?: string;
  purpose?: string;
  cateringRequired?: boolean;
  specialRequirements?: string;
  inviteNote?: string;
  facilityIds?: string[];
  attendees?: { name: string; employeeId?: string; department?: string; email?: string; phone?: string }[];
  draft?: boolean;
};

function combineRange(startAt: Date, endAt: Date) {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new AppError('Invalid start time.');
  }
  if (endAt <= startAt) throw new AppError('End time must be after start time.');
  return { startAt, endAt, bookingDate: startAt.toISOString().slice(0, 10) };
}

async function assertHallReady(hallId: string, startAt: Date, endAt: Date, attendeeCount: number) {
  const hall = await queryOne<{
    Id: string;
    Code: string;
    Name: string;
    Capacity: number;
    Status: string;
    IsActive: boolean;
    OpeningTime: string;
    ClosingTime: string;
  }>(
    `SELECT Id, Code, Name, Capacity, Status, IsActive,
            CONVERT(varchar(8), OpeningTime, 108) AS OpeningTime,
            CONVERT(varchar(8), ClosingTime, 108) AS ClosingTime
     FROM dbo.conference_halls WHERE Id = @Id AND DeletedAt IS NULL`,
    { Id: hallId },
  );
  if (!hall || !hall.IsActive) throw new AppError('Conference hall is not available.');
  if (hall.Status === 'BLOCKED') throw new AppError('Conference hall is blocked.');
  if (attendeeCount > hall.Capacity) {
    throw new AppError(`Attendee count exceeds hall capacity (${hall.Capacity}).`);
  }
  const startClock = startAt.toTimeString().slice(0, 8);
  const endClock = endAt.toTimeString().slice(0, 8);
  if (startClock < hall.OpeningTime || endClock > hall.ClosingTime) {
    throw new AppError(`Booking must be within hall hours ${hall.OpeningTime.slice(0, 5)}–${hall.ClosingTime.slice(0, 5)}.`);
  }
  return hall;
}

async function lockConflicts(
  tx: DbTx,
  hallId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
) {
  const bookingConflict = await txQueryOne<ConflictRow>(
    tx,
    `SELECT Id, BookingNumber, EventName, StartAt, EndAt, Status
     FROM dbo.bookings
     WHERE HallId = @HallId
       AND DeletedAt IS NULL
       AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT', N'NO_SHOW')
       AND (@ExcludeBookingId IS NULL OR Id <> @ExcludeBookingId)
       AND StartAt < @EndAt
       AND EndAt > @StartAt
     LIMIT 1
     FOR UPDATE`,
    { HallId: hallId, StartAt: startAt, EndAt: endAt, ExcludeBookingId: excludeId ?? null },
  );
  if (bookingConflict) {
    throw new ConflictError('Conference hall is already booked for this time.');
  }
  const maint = await txQueryOne(
    tx,
    `SELECT Id, Title, StartAt, EndAt, Status
     FROM dbo.hall_maintenance
     WHERE HallId = @HallId
       AND DeletedAt IS NULL
       AND Status IN (N'SCHEDULED', N'IN_PROGRESS')
       AND StartAt < @EndAt
       AND EndAt > @StartAt
     LIMIT 1
     FOR UPDATE`,
    { HallId: hallId, StartAt: startAt, EndAt: endAt },
  );
  if (maint) {
    throw new ConflictError('Conference hall is under maintenance for this time.');
  }
}

async function recordHistory(
  tx: DbTx,
  bookingId: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string,
  comment?: string,
) {
  await txInsert(
    tx,
    `INSERT INTO dbo.booking_status_history (BookingId, FromStatus, ToStatus, Comment, ActorId)
     VALUES (@BookingId, @FromStatus, @ToStatus, @Comment, @ActorId)`,
    {
      BookingId: bookingId,
      FromStatus: fromStatus,
      ToStatus: toStatus,
      Comment: comment ?? null,
      ActorId: actorId,
    },
  );
}

export async function createBooking(user: AuthUser, input: CreateBookingInput, req: Request) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const range = combineRange(startAt, endAt);
  if (startAt.getTime() < Date.now() - 60_000) {
    throw new AppError(
      'Cannot book a time in the past. Pick a later start time or a future date (your slot was earlier today).',
    );
  }
  const hall = await assertHallReady(input.hallId, startAt, endAt, input.attendeeCount);
  // No approval step: a free hall and a free slot are the only gate.
  const status = input.draft ? 'DRAFT' : 'CONFIRMED';
  const organizerId = input.organizerId ?? user.id;
  const number = bookingNumber(startAt);
  const qr = newQrToken();
  let id = '';

  await withTransaction(async (tx) => {
    if (status !== 'DRAFT') {
      await lockConflicts(tx, input.hallId, startAt, endAt);
    }
    id = await txInsert(
      tx,
      `INSERT INTO dbo.bookings (
          BookingNumber, EventName, EventType, DepartmentId, OrganizerId, ContactNumber, ContactEmail, HallId,
          BookingDate, StartAt, EndAt, AttendeeCount, SeatingLayoutId, Purpose, CateringRequired,
          SpecialRequirements, InviteNote, Status, QrToken, RequiresApproval, CreatedBy, UpdatedBy
        ) VALUES (
          @BookingNumber, @EventName, @EventType, @DepartmentId, @OrganizerId, @ContactNumber, @ContactEmail, @HallId,
          CAST(@BookingDate AS DATE), @StartAt, @EndAt, @AttendeeCount, @SeatingLayoutId, @Purpose, @CateringRequired,
          @SpecialRequirements, @InviteNote, @Status, @QrToken, @RequiresApproval, @Actor, @Actor
        )`,
      {
        BookingNumber: number,
        EventName: input.eventName.trim(),
        EventType: input.eventType,
        DepartmentId: input.departmentId,
        OrganizerId: organizerId,
        ContactNumber: input.contactNumber ?? null,
        ContactEmail: input.mailId?.trim().toLowerCase() ?? null,
        HallId: input.hallId,
        BookingDate: range.bookingDate,
        StartAt: startAt,
        EndAt: endAt,
        AttendeeCount: input.attendeeCount,
        SeatingLayoutId: input.seatingLayoutId ?? null,
        Purpose: input.purpose ?? null,
        CateringRequired: input.cateringRequired ?? false,
        SpecialRequirements: input.specialRequirements ?? null,
        InviteNote: input.inviteNote ?? (input.invitationEmails?.join(', ') ?? null),
        Status: status,
        QrToken: qr,
        RequiresApproval: false,
        Actor: user.id,
      },
    );
    await txInsert(
      tx,
      `INSERT INTO dbo.events (BookingId, Description, ExpectedAttendees, Requirements)
       VALUES (@BookingId, @Description, @Expected, @Req)`,
      {
        BookingId: id,
        Description: input.purpose ?? null,
        Expected: input.attendeeCount,
        Req: input.specialRequirements ?? null,
      },
    );
    await recordHistory(tx, id, null, status, user.id);
    for (const facilityId of input.facilityIds ?? []) {
      await txQuery(
        tx,
        `INSERT INTO dbo.booking_facilities (BookingId, FacilityId) VALUES (@BookingId, @FacilityId)`,
        { BookingId: id, FacilityId: facilityId },
      );
    }
    for (const attendee of input.attendees ?? []) {
      await txInsert(
        tx,
        `INSERT INTO dbo.booking_attendees (BookingId, Name, EmployeeId, Department, Email, Phone)
         VALUES (@BookingId, @Name, @EmployeeId, @Department, @Email, @Phone)`,
        {
          BookingId: id,
          Name: attendee.name,
          EmployeeId: attendee.employeeId ?? null,
          Department: attendee.department ?? null,
          Email: attendee.email ?? null,
          Phone: attendee.phone ?? null,
        },
      );
    }
    const inviteOnly = (input.invitationEmails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .filter((email) => !(input.attendees ?? []).some((a) => a.email?.toLowerCase() === email));
    for (const email of inviteOnly) {
      await txInsert(
        tx,
        `INSERT INTO dbo.booking_attendees (BookingId, Name, Email)
         VALUES (@BookingId, @Name, @Email)`,
        {
          BookingId: id,
          Name: email.split('@')[0] ?? email,
          Email: email,
        },
      );
    }
  }, sql.ISOLATION_LEVEL.SERIALIZABLE);

  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.BOOKING_CREATED,
    module: 'bookings',
    recordId: id,
    newValue: { number, hall: hall.Code, startAt },
    req,
  });

  const managers = await query<{ Id: string }>(
    `SELECT u.Id FROM dbo.users u
     JOIN dbo.roles r ON r.Id = u.RoleId
     WHERE u.DeletedAt IS NULL AND u.Status = N'ACTIVE'
       AND r.Code IN (N'HALL_MANAGER', N'ADMINISTRATOR')`,
  );
  await notify({
    userId: organizerId,
    type: 'BOOKING_CREATED',
    title: 'Booking created',
    message: `${input.eventName} in ${hall.Name} was submitted.`,
    relatedModule: 'bookings',
    relatedId: id,
  });
  if (status !== 'DRAFT') {
    await notifyMany(
      managers.map((m) => m.Id),
      {
        type: 'BOOKING_CREATED',
        title: 'Hall booked',
        message: `${input.eventName} is confirmed in ${hall.Name}.`,
        relatedModule: 'bookings',
        relatedId: id,
      },
    );
  }

  const inviteTargets = [
    ...new Set(
      [
        ...(input.invitationEmails ?? []).map((e) => e.trim().toLowerCase()),
        ...(input.attendees ?? []).map((a) => a.email?.trim().toLowerCase()),
      ].filter((e): e is string => Boolean(e)),
    ),
  ];
  const hallLoc = await queryOne<{ Location: string | null }>(
    `SELECT Location FROM dbo.conference_halls WHERE Id = @Id`,
    { Id: hall.Id },
  );
  const organizerName = `${user.firstName} ${user.lastName}`.trim();
  const guests = inviteTargets.map((email) => ({
    email,
    name: (input.attendees ?? []).find((a) => a.email?.trim().toLowerCase() === email)?.name ?? null,
  }));
  const cards: InvitationCard[] =
    status === 'DRAFT'
      ? []
      : inviteTargets.map((to) => ({
          uid: id,
          to,
          toName: guests.find((g) => g.email === to)?.name ?? null,
          eventName: input.eventName.trim(),
          eventType: input.eventType,
          hallName: hall.Name,
          hallLocation: hallLoc?.Location ?? null,
          startAt,
          endAt,
          purpose: input.purpose ?? null,
          organizerEmail: user.email.trim().toLowerCase(),
          organizerName,
          bookingNumber: number,
          guests,
        }));
  const inviteMail = await sendMeetingInvites(cards);

  emit(SOCKET_EVENTS.BOOKING_CREATED, { id, hallId: hall.Id, hallCode: hall.Code, status });
  return { ...(await getBookingById(id, user)), inviteMail };
}

export async function updateBooking(user: AuthUser, id: string, input: Partial<CreateBookingInput>, req: Request) {
  const existing = await getBooking(id);
  if (!canManage(user, existing)) throw new AppError('You cannot edit this booking.', 403);
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW', 'REJECTED', 'ONGOING'].includes(existing.Status)) {
    throw new AppError('This booking can no longer be edited.');
  }
  const startAt = input.startAt ? new Date(input.startAt) : new Date(existing.StartAt);
  const endAt = input.endAt ? new Date(input.endAt) : new Date(existing.EndAt);
  combineRange(startAt, endAt);
  const hallId = input.hallId ?? existing.HallId;
  const attendeeCount = input.attendeeCount ?? existing.AttendeeCount;
  const hall = await assertHallReady(hallId, startAt, endAt, attendeeCount);

  await withTransaction(async (tx) => {
    await lockConflicts(tx, hallId, startAt, endAt, id);
    await txQuery(
      tx,
      `UPDATE dbo.bookings SET
          EventName = COALESCE(@EventName, EventName),
          EventType = COALESCE(@EventType, EventType),
          DepartmentId = COALESCE(@DepartmentId, DepartmentId),
          ContactNumber = COALESCE(@ContactNumber, ContactNumber),
          HallId = @HallId,
          BookingDate = CAST(@BookingDate AS DATE),
          StartAt = @StartAt,
          EndAt = @EndAt,
          AttendeeCount = @AttendeeCount,
          SeatingLayoutId = COALESCE(@SeatingLayoutId, SeatingLayoutId),
          Purpose = COALESCE(@Purpose, Purpose),
          CateringRequired = COALESCE(@CateringRequired, CateringRequired),
          SpecialRequirements = COALESCE(@SpecialRequirements, SpecialRequirements),
          InviteNote = COALESCE(@InviteNote, InviteNote),
          UpdatedAt = SYSUTCDATETIME(),
          UpdatedBy = @Actor
       WHERE Id = @Id`,
      {
        Id: id,
        EventName: input.eventName ?? null,
        EventType: input.eventType ?? null,
        DepartmentId: input.departmentId ?? null,
        ContactNumber: input.contactNumber ?? null,
        HallId: hallId,
        BookingDate: startAt.toISOString().slice(0, 10),
        StartAt: startAt,
        EndAt: endAt,
        AttendeeCount: attendeeCount,
        SeatingLayoutId: input.seatingLayoutId ?? null,
        Purpose: input.purpose ?? null,
        CateringRequired: input.cateringRequired ?? null,
        SpecialRequirements: input.specialRequirements ?? null,
        InviteNote: input.inviteNote ?? null,
        Actor: user.id,
      },
    );
    if (input.facilityIds) {
      await txQuery(tx, `DELETE FROM dbo.booking_facilities WHERE BookingId = @Id`, { Id: id });
      for (const facilityId of input.facilityIds) {
        await txQuery(
          tx,
          `INSERT INTO dbo.booking_facilities (BookingId, FacilityId) VALUES (@BookingId, @FacilityId)`,
          { BookingId: id, FacilityId: facilityId },
        );
      }
    }
  }, sql.ISOLATION_LEVEL.SERIALIZABLE);

  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.BOOKING_UPDATED,
    module: 'bookings',
    recordId: id,
    req,
  });
  emit(SOCKET_EVENTS.BOOKING_UPDATED, { id, hallId: hall.Id, hallCode: hall.Code, status: existing.Status });
  return getBookingById(id, user);
}

export async function cancelBooking(user: AuthUser, id: string, reason: string | undefined, req: Request) {
  const existing = await getBooking(id);
  if (!canManage(user, existing)) throw new AppError('You cannot cancel this booking.', 403);
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(existing.Status)) {
    throw new AppError('Booking cannot be cancelled.');
  }
  const note = reason?.trim() ?? '';
  if (note.length < 3) throw new AppError('Please enter a cancellation reason.');
  await withTransaction(async (tx) => {
    await txQuery(
      tx,
      `UPDATE dbo.bookings SET Status = N'CANCELLED', CancelledBy = @Actor, CancelledAt = SYSUTCDATETIME(),
              CancellationReason = @Reason, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor
       WHERE Id = @Id`,
      { Id: id, Actor: user.id, Reason: note },
    );
    await recordHistory(tx, id, existing.Status, 'CANCELLED', user.id, note);
  });
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.BOOKING_CANCELLED,
    module: 'bookings',
    recordId: id,
    newValue: { reason },
    req,
  });
  await notify({
    userId: existing.OrganizerId,
    type: 'BOOKING_CANCELLED',
    title: 'Booking cancelled',
    message: `${existing.EventName} was cancelled.`,
    relatedModule: 'bookings',
    relatedId: id,
  });
  emit(SOCKET_EVENTS.BOOKING_CANCELLED, {
    id,
    hallId: existing.HallId,
    hallCode: existing.HallCode,
    status: 'CANCELLED',
  });
  const attendees = await query<{ Email: string | null; Name: string }>(
    `SELECT Email, Name FROM dbo.booking_attendees WHERE BookingId = @Id`,
    { Id: id },
  );
  const mails = [
    ...new Set(
      [...attendees.map((a) => a.Email?.trim().toLowerCase()), existing.ContactEmail?.trim().toLowerCase()].filter(
        (e): e is string => Boolean(e),
      ),
    ),
  ];
  const guests = mails.map((email) => ({
    email,
    name: attendees.find((a) => a.Email?.trim().toLowerCase() === email)?.Name ?? existing.OrganizerName,
  }));
  await Promise.all(
    mails.map((to) =>
      sendCancellationCard({
        uid: id,
        to,
        toName: guests.find((g) => g.email === to)?.name ?? null,
        eventName: existing.EventName,
        eventType: existing.EventType,
        hallName: existing.HallName,
        startAt: new Date(existing.StartAt),
        endAt: new Date(existing.EndAt),
        purpose: note,
        organizerEmail: user.email.trim().toLowerCase(),
        organizerName: `${user.firstName} ${user.lastName}`.trim(),
        bookingNumber: existing.BookingNumber,
        guests,
      }),
    ),
  );
  return getBookingById(id, user);
}

export async function deleteBooking(user: AuthUser, id: string, req: Request) {
  const existing = await getBooking(id);
  if (!canManage(user, existing)) throw new AppError('You cannot delete this booking.', 403);
  if (new Date(existing.StartAt).getTime() <= Date.now()) {
    throw new AppError('Bookings can only be deleted before the meeting starts.');
  }
  if (['COMPLETED', 'ONGOING'].includes(existing.Status)) {
    throw new AppError('This booking can no longer be deleted.');
  }
  await query(
    `UPDATE dbo.bookings SET DeletedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor
     WHERE Id = @Id AND DeletedAt IS NULL`,
    { Id: id, Actor: user.id },
  );
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.BOOKING_DELETED,
    module: 'bookings',
    recordId: id,
    oldValue: { bookingNumber: existing.BookingNumber, eventName: existing.EventName },
    req,
  });
  if (existing.OrganizerId !== user.id) {
    await notify({
      userId: existing.OrganizerId,
      type: 'BOOKING_CANCELLED',
      title: 'Booking deleted',
      message: `${existing.EventName} was deleted.`,
      relatedModule: 'bookings',
      relatedId: id,
    });
  }
  emit(SOCKET_EVENTS.BOOKING_DELETED, {
    id,
    hallId: existing.HallId,
    hallCode: existing.HallCode,
  });
  emit(SOCKET_EVENTS.BOOKING_CANCELLED, {
    id,
    hallId: existing.HallId,
    hallCode: existing.HallCode,
    status: 'DELETED',
  });
}

export async function approveBooking(user: AuthUser, id: string, comment: string | undefined, req: Request) {
  const existing = await getBooking(id);
  if (existing.Status !== 'PENDING' && existing.Status !== 'APPROVED') {
    throw new AppError('Only pending bookings can be approved.');
  }
  await withTransaction(async (tx) => {
    await lockConflicts(tx, existing.HallId, new Date(existing.StartAt), new Date(existing.EndAt), id);
    await txQuery(
      tx,
      `UPDATE dbo.bookings SET Status = N'CONFIRMED', ApprovedBy = @Actor, ApprovedAt = SYSUTCDATETIME(),
              UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor
       WHERE Id = @Id`,
      { Id: id, Actor: user.id },
    );
    await recordHistory(tx, id, existing.Status, 'APPROVED', user.id, comment);
    await recordHistory(tx, id, 'APPROVED', 'CONFIRMED', user.id);
  }, sql.ISOLATION_LEVEL.SERIALIZABLE);
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.BOOKING_APPROVED,
    module: 'bookings',
    recordId: id,
    req,
  });
  await notify({
    userId: existing.OrganizerId,
    type: 'BOOKING_APPROVED',
    title: 'Booking approved',
    message: `${existing.EventName} is confirmed in ${existing.HallName}.`,
    relatedModule: 'bookings',
    relatedId: id,
  });
  emit(SOCKET_EVENTS.BOOKING_APPROVED, {
    id,
    hallId: existing.HallId,
    hallCode: existing.HallCode,
    status: 'CONFIRMED',
  });
  return getBookingById(id, user);
}

export async function rejectBooking(user: AuthUser, id: string, reason: string, req: Request) {
  const existing = await getBooking(id);
  if (existing.Status !== 'PENDING') throw new AppError('Only pending bookings can be rejected.');
  if (!reason?.trim()) throw new AppError('Rejection reason is required.');
  await withTransaction(async (tx) => {
    await txQuery(
      tx,
      `UPDATE dbo.bookings SET Status = N'REJECTED', RejectedBy = @Actor, RejectedAt = SYSUTCDATETIME(),
              RejectionReason = @Reason, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @Actor
       WHERE Id = @Id`,
      { Id: id, Actor: user.id, Reason: reason.trim() },
    );
    await recordHistory(tx, id, existing.Status, 'REJECTED', user.id, reason);
  });
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.BOOKING_REJECTED,
    module: 'bookings',
    recordId: id,
    newValue: { reason },
    req,
  });
  await notify({
    userId: existing.OrganizerId,
    type: 'BOOKING_REJECTED',
    title: 'Booking rejected',
    message: `${existing.EventName} was rejected: ${reason.trim()}`,
    relatedModule: 'bookings',
    relatedId: id,
  });
  emit(SOCKET_EVENTS.BOOKING_UPDATED, {
    id,
    hallId: existing.HallId,
    hallCode: existing.HallCode,
    status: 'REJECTED',
  });
  return getBookingById(id, user);
}

export async function listBookings(
  user: AuthUser,
  filters: {
    tab?: string;
    hallId?: string;
    status?: string;
    departmentId?: string;
    from?: string;
    to?: string;
    q?: string;
    page: number;
    pageSize: number;
  },
): Promise<Paged<BookingRow>> {
  const where = ['b.DeletedAt IS NULL'];
  const inputs: Record<string, unknown> = {
    Offset: (filters.page - 1) * filters.pageSize,
    PageSize: filters.pageSize,
    UserId: user.id,
  };
  if (!user.permissions.includes('bookings.view_all')) {
    where.push('b.OrganizerId = @UserId');
  }
  const tab = filters.tab;
  if (tab === 'upcoming') {
    where.push(`b.Status IN (N'PENDING', N'APPROVED', N'CONFIRMED') AND b.StartAt > SYSUTCDATETIME()`);
  } else if (tab === 'today') {
    where.push(`CAST(b.StartAt AS DATE) = CAST(SYSUTCDATETIME() AS DATE) AND b.Status NOT IN (N'CANCELLED', N'REJECTED')`);
  } else if (tab === 'ongoing') {
    where.push(`b.Status = N'ONGOING'`);
  } else if (tab === 'completed') {
    where.push(`b.Status IN (N'COMPLETED', N'NO_SHOW')`);
  } else if (tab === 'cancelled') {
    where.push(`b.Status = N'CANCELLED'`);
  } else if (tab === 'pending') {
    where.push(`b.Status = N'PENDING'`);
  }
  if (filters.hallId) {
    where.push('b.HallId = @HallId');
    inputs.HallId = filters.hallId;
  }
  if (filters.status) {
    where.push('b.Status = @Status');
    inputs.Status = filters.status;
  }
  if (filters.departmentId) {
    where.push('b.DepartmentId = @DepartmentId');
    inputs.DepartmentId = filters.departmentId;
  }
  if (filters.from) {
    where.push('b.EndAt >= @From');
    inputs.From = new Date(filters.from);
  }
  if (filters.to) {
    where.push('b.StartAt <= @To');
    inputs.To = new Date(filters.to);
  }
  if (filters.q) {
    where.push(`(b.EventName LIKE @Q OR b.BookingNumber LIKE @Q OR h.Name LIKE @Q)`);
    inputs.Q = `%${filters.q}%`;
  }
  const clause = where.join(' AND ');
  const total = await queryOne<{ Cnt: number }>(
    `SELECT COUNT(*) AS Cnt FROM dbo.bookings b JOIN dbo.conference_halls h ON h.Id = b.HallId WHERE ${clause}`,
    inputs,
  );
  const items = await query<BookingRow>(
    `${BOOKING_SELECT} WHERE ${clause} ORDER BY b.StartAt DESC OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY`,
    inputs,
  );
  return { items: items.map(omitQr), page: filters.page, pageSize: filters.pageSize, total: total?.Cnt ?? 0 };
}

export async function listApprovals() {
  const rows = await query<BookingRow>(
    `${BOOKING_SELECT} WHERE b.DeletedAt IS NULL AND b.Status = N'PENDING' ORDER BY b.StartAt`,
  );
  return rows.map(omitQr);
}

export async function calendarEvents(from: string, to: string, hallId?: string) {
  const inputs: Record<string, unknown> = { From: new Date(from), To: new Date(to) };
  let hallFilter = '';
  if (hallId) {
    hallFilter = 'AND b.HallId = @HallId';
    inputs.HallId = hallId;
  }
  const bookings = await query(
    `SELECT b.Id, b.EventName, b.StartAt, b.EndAt, b.Status, h.Name AS HallName, h.Code AS HallCode, h.Id AS HallId
     FROM dbo.bookings b
     JOIN dbo.conference_halls h ON h.Id = b.HallId
     WHERE b.DeletedAt IS NULL AND b.Status NOT IN (N'DRAFT')
       AND b.StartAt < @To AND b.EndAt > @From ${hallFilter}`,
    inputs,
  );
  const maintenance = await query(
    `SELECT m.Id, m.Title AS EventName, m.StartAt, m.EndAt, N'MAINTENANCE' AS Status,
            h.Name AS HallName, h.Code AS HallCode, h.Id AS HallId
     FROM dbo.hall_maintenance m
     JOIN dbo.conference_halls h ON h.Id = m.HallId
     WHERE m.DeletedAt IS NULL AND m.Status IN (N'SCHEDULED', N'IN_PROGRESS')
       AND m.StartAt < @To AND m.EndAt > @From ${hallId ? 'AND m.HallId = @HallId' : ''}`,
    inputs,
  );
  return { bookings, maintenance };
}

export async function transitionDueBookings(): Promise<void> {
  const starting = await query<BookingRow>(
    `${BOOKING_SELECT}
     WHERE b.DeletedAt IS NULL AND b.Status = N'CONFIRMED'
       AND b.StartAt <= SYSUTCDATETIME() AND b.EndAt > SYSUTCDATETIME()`,
  );
  for (const row of starting) {
    await query(`UPDATE dbo.bookings SET Status = N'ONGOING', UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id`, {
      Id: row.Id,
    });
    emit(SOCKET_EVENTS.BOOKING_STARTED, {
      id: row.Id,
      hallId: row.HallId,
      hallCode: row.HallCode,
      status: 'ONGOING',
    });
    await notify({
      userId: row.OrganizerId,
      type: 'EVENT_STARTING',
      title: 'Event starting',
      message: `${row.EventName} is now in progress in ${row.HallName}.`,
      relatedModule: 'bookings',
      relatedId: row.Id,
    });
  }

  const ending = await query<BookingRow>(
    `${BOOKING_SELECT}
     WHERE b.DeletedAt IS NULL AND b.Status IN (N'ONGOING', N'CONFIRMED')
       AND b.EndAt <= SYSUTCDATETIME()`,
  );
  for (const row of ending) {
    await query(`UPDATE dbo.bookings SET Status = N'COMPLETED', UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id`, {
      Id: row.Id,
    });
    emit(SOCKET_EVENTS.BOOKING_COMPLETED, {
      id: row.Id,
      hallId: row.HallId,
      hallCode: row.HallCode,
      status: 'COMPLETED',
    });
    await notify({
      userId: row.OrganizerId,
      type: 'EVENT_COMPLETED',
      title: 'Event completed',
      message: `${row.EventName} has ended.`,
      relatedModule: 'bookings',
      relatedId: row.Id,
    });
  }
}
