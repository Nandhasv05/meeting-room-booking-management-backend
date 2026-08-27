import { query, queryOne, insert } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from '../middleware/auditLogger.js';
import { AUDIT_ACTIONS, SOCKET_EVENTS } from '../config/constants.js';
import { getIo } from '../sockets/registry.js';
import type { Request } from 'express';
import type { AuthUser } from '../types/index.js';
import type { HallRow } from '../types/db.js';

const HALL_SELECT = `
  SELECT h.Id, h.Name, h.Code, h.Description, h.Location, h.Building, h.Floor, h.Capacity,
         h.HallType, h.Status, h.ImageUrl, CONVERT(varchar(8), h.OpeningTime, 108) AS OpeningTime,
         CONVERT(varchar(8), h.ClosingTime, 108) AS ClosingTime, h.ContactPersonId,
         CONCAT(u.FirstName, ' ', u.LastName) AS ContactName, h.IsActive, h.CreatedAt
  FROM dbo.conference_halls h
  LEFT JOIN dbo.users u ON u.Id = h.ContactPersonId
`;

export async function listHalls(filters: { q?: string; status?: string; building?: string; active?: string }) {
  const where = ['h.DeletedAt IS NULL'];
  const inputs: Record<string, unknown> = {};
  if (filters.q) {
    where.push(`(h.Name LIKE @Q OR h.Code LIKE @Q OR h.Location LIKE @Q)`);
    inputs.Q = `%${filters.q}%`;
  }
  if (filters.status) {
    where.push('h.Status = @Status');
    inputs.Status = filters.status;
  }
  if (filters.building) {
    where.push('h.Building = @Building');
    inputs.Building = filters.building;
  }
  if (filters.active === 'true') where.push('h.IsActive = 1');
  if (filters.active === 'false') where.push('h.IsActive = 0');
  return query<HallRow>(`${HALL_SELECT} WHERE ${where.join(' AND ')} ORDER BY h.Name`, inputs);
}

export async function getHall(id: string) {
  const hall = await queryOne<HallRow>(`${HALL_SELECT} WHERE h.Id = @Id AND h.DeletedAt IS NULL`, { Id: id });
  if (!hall) throw new AppError('Conference hall not found.', 404);
  const facilities = await query<{ Id: string; Code: string; Name: string }>(
    `SELECT f.Id, f.Code, f.Name
     FROM dbo.hall_facilities hf
     JOIN dbo.facilities f ON f.Id = hf.FacilityId
     WHERE hf.HallId = @Id`,
    { Id: id },
  );
  const layouts = await query(
    `SELECT Id, Name, Capacity, LayoutJson, IsDefault FROM dbo.hall_seating_layouts WHERE HallId = @Id`,
    { Id: id },
  );
  return { ...hall, facilities, layouts };
}

export async function getHallByCode(code: string) {
  const hall = await queryOne<HallRow>(`${HALL_SELECT} WHERE h.Code = @Code AND h.DeletedAt IS NULL`, {
    Code: code,
  });
  if (!hall) throw new AppError('Conference hall not found.', 404);
  return hall;
}

type HallInput = {
  name: string;
  code: string;
  description?: string;
  location?: string;
  building?: string;
  floor?: string;
  capacity: number;
  hallType: string;
  status?: string;
  imageUrl?: string;
  openingTime: string;
  closingTime: string;
  contactPersonId?: string;
  isActive?: boolean;
  facilityIds?: string[];
  layouts?: { name: string; capacity: number; isDefault?: boolean }[];
};

export async function createHall(actor: AuthUser, input: HallInput, req: Request) {
  const id = await insert(
    `INSERT INTO dbo.conference_halls
      (Name, Code, Description, Location, Building, Floor, Capacity, HallType, Status, ImageUrl,
       OpeningTime, ClosingTime, ContactPersonId, IsActive, CreatedBy, UpdatedBy)
     VALUES
      (@Name, @Code, @Description, @Location, @Building, @Floor, @Capacity, @HallType, @Status, @ImageUrl,
       CAST(@OpeningTime AS TIME), CAST(@ClosingTime AS TIME), @ContactPersonId, @IsActive, @Actor, @Actor)`,
    {
      Name: input.name.trim(),
      Code: input.code.trim().toUpperCase(),
      Description: input.description ?? null,
      Location: input.location ?? null,
      Building: input.building ?? null,
      Floor: input.floor ?? null,
      Capacity: input.capacity,
      HallType: input.hallType,
      Status: input.status ?? 'AVAILABLE',
      ImageUrl: input.imageUrl ?? null,
      OpeningTime: input.openingTime,
      ClosingTime: input.closingTime,
      ContactPersonId: input.contactPersonId ?? null,
      IsActive: input.isActive ?? true,
      Actor: actor.id,
    },
  );
  await syncFacilities(id, input.facilityIds ?? []);
  await syncLayouts(id, input.layouts ?? []);
  await writeAudit({
    userId: actor.id,
    action: AUDIT_ACTIONS.HALL_CREATED,
    module: 'halls',
    recordId: id,
    newValue: { code: input.code },
    req,
  });
  getIo()?.emit(SOCKET_EVENTS.HALL_STATUS, { hallId: id });
  return getHall(id);
}

export async function updateHall(actor: AuthUser, id: string, input: Partial<HallInput>, req: Request) {
  const existing = await getHall(id);
  await query(
    `UPDATE dbo.conference_halls SET
        Name = COALESCE(@Name, Name),
        Description = COALESCE(@Description, Description),
        Location = COALESCE(@Location, Location),
        Building = COALESCE(@Building, Building),
        Floor = COALESCE(@Floor, Floor),
        Capacity = COALESCE(@Capacity, Capacity),
        HallType = COALESCE(@HallType, HallType),
        Status = COALESCE(@Status, Status),
        ImageUrl = COALESCE(@ImageUrl, ImageUrl),
        OpeningTime = COALESCE(CAST(@OpeningTime AS TIME), OpeningTime),
        ClosingTime = COALESCE(CAST(@ClosingTime AS TIME), ClosingTime),
        ContactPersonId = COALESCE(@ContactPersonId, ContactPersonId),
        IsActive = COALESCE(@IsActive, IsActive),
        UpdatedAt = SYSUTCDATETIME(),
        UpdatedBy = @Actor
     WHERE Id = @Id AND DeletedAt IS NULL`,
    {
      Id: id,
      Name: input.name ?? null,
      Description: input.description ?? null,
      Location: input.location ?? null,
      Building: input.building ?? null,
      Floor: input.floor ?? null,
      Capacity: input.capacity ?? null,
      HallType: input.hallType ?? null,
      Status: input.status ?? null,
      ImageUrl: input.imageUrl ?? null,
      OpeningTime: input.openingTime ?? null,
      ClosingTime: input.closingTime ?? null,
      ContactPersonId: input.contactPersonId ?? null,
      IsActive: input.isActive ?? null,
      Actor: actor.id,
    },
  );
  if (input.facilityIds) await syncFacilities(id, input.facilityIds);
  if (input.layouts) await syncLayouts(id, input.layouts);
  await writeAudit({
    userId: actor.id,
    action: AUDIT_ACTIONS.HALL_UPDATED,
    module: 'halls',
    recordId: id,
    oldValue: { status: existing.Status },
    newValue: { status: input.status ?? existing.Status },
    req,
  });
  getIo()?.emit(SOCKET_EVENTS.HALL_STATUS, { hallId: id, hallCode: existing.Code });
  getIo()?.to(`hall:${existing.Code}`).emit(SOCKET_EVENTS.HALL_STATUS, { hallId: id });
  return getHall(id);
}

export async function deleteHall(actor: AuthUser, id: string, req: Request) {
  const hall = await getHall(id);
  await query(
    `UPDATE dbo.conference_halls SET DeletedAt = SYSUTCDATETIME(), IsActive = 0, UpdatedBy = @Actor WHERE Id = @Id`,
    { Id: id, Actor: actor.id },
  );
  await writeAudit({
    userId: actor.id,
    action: AUDIT_ACTIONS.HALL_DELETED,
    module: 'halls',
    recordId: id,
    oldValue: { code: hall.Code },
    req,
  });
}

async function syncFacilities(hallId: string, facilityIds: string[]) {
  await query(`DELETE FROM dbo.hall_facilities WHERE HallId = @HallId`, { HallId: hallId });
  for (const facilityId of facilityIds) {
    await query(`INSERT INTO dbo.hall_facilities (HallId, FacilityId) VALUES (@HallId, @FacilityId)`, {
      HallId: hallId,
      FacilityId: facilityId,
    });
  }
}

async function syncLayouts(hallId: string, layouts: { name: string; capacity: number; isDefault?: boolean }[]) {
  await query(`DELETE FROM dbo.hall_seating_layouts WHERE HallId = @HallId`, { HallId: hallId });
  for (const layout of layouts) {
    await insert(
      `INSERT INTO dbo.hall_seating_layouts (HallId, Name, Capacity, IsDefault)
       VALUES (@HallId, @Name, @Capacity, @IsDefault)`,
      {
        HallId: hallId,
        Name: layout.name,
        Capacity: layout.capacity,
        IsDefault: layout.isDefault ?? false,
      },
    );
  }
}

export async function listFacilities() {
  return query(`SELECT Id, Code, Name, Icon, IsActive FROM dbo.facilities ORDER BY Name`);
}

export async function createFacility(input: { code: string; name: string; icon?: string }) {
  const id = await insert(
    `INSERT INTO dbo.facilities (Code, Name, Icon) VALUES (@Code, @Name, @Icon)`,
    { Code: input.code.trim().toUpperCase(), Name: input.name.trim(), Icon: input.icon ?? null },
  );
  return queryOne(`SELECT Id, Code, Name, Icon, IsActive FROM dbo.facilities WHERE Id = @Id`, { Id: id });
}

export async function updateFacility(id: string, input: { name?: string; icon?: string; isActive?: boolean }) {
  await query(
    `UPDATE dbo.facilities SET Name = COALESCE(@Name, Name), Icon = COALESCE(@Icon, Icon),
            IsActive = COALESCE(@IsActive, IsActive), UpdatedAt = SYSUTCDATETIME()
     WHERE Id = @Id`,
    { Id: id, Name: input.name ?? null, Icon: input.icon ?? null, IsActive: input.isActive ?? null },
  );
  return queryOne(`SELECT Id, Code, Name, Icon, IsActive FROM dbo.facilities WHERE Id = @Id`, { Id: id });
}

export async function deleteFacility(id: string) {
  await query(`DELETE FROM dbo.hall_facilities WHERE FacilityId = @Id`, { Id: id });
  await query(`DELETE FROM dbo.facilities WHERE Id = @Id`, { Id: id });
}

export async function hallAvailability(hallId: string, from: string, to: string) {
  await getHall(hallId);
  const bookings = await query(
    `SELECT Id, EventName, StartAt, EndAt, Status, OrganizerId
     FROM dbo.bookings
     WHERE HallId = @HallId AND DeletedAt IS NULL
       AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT', N'NO_SHOW')
       AND StartAt < @To AND EndAt > @From
     ORDER BY StartAt`,
    { HallId: hallId, From: new Date(from), To: new Date(to) },
  );
  const maintenance = await query(
    `SELECT Id, Title, StartAt, EndAt, Status
     FROM dbo.hall_maintenance
     WHERE HallId = @HallId AND DeletedAt IS NULL
       AND Status IN (N'SCHEDULED', N'IN_PROGRESS')
       AND StartAt < @To AND EndAt > @From`,
    { HallId: hallId, From: new Date(from), To: new Date(to) },
  );
  return { bookings, maintenance };
}
