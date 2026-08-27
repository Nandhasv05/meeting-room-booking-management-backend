import { query, queryOne, insert } from '../config/database.js';
import { AppError } from '../utils/AppError.js';
import { writeAudit } from '../middleware/auditLogger.js';
import { AUDIT_ACTIONS, SOCKET_EVENTS } from '../config/constants.js';
import { getIo } from '../sockets/registry.js';
import type { Request } from 'express';
import type { AuthUser } from '../types/index.js';

export async function listMaintenance(hallId?: string) {
  const where = ['m.DeletedAt IS NULL'];
  const inputs: Record<string, unknown> = {};
  if (hallId) {
    where.push('m.HallId = @HallId');
    inputs.HallId = hallId;
  }
  return query(
    `SELECT m.Id, m.HallId, h.Name AS HallName, h.Code AS HallCode, m.Title, m.Description,
            m.StartAt, m.EndAt, m.Status, m.CreatedAt
     FROM dbo.hall_maintenance m
     JOIN dbo.conference_halls h ON h.Id = m.HallId
     WHERE ${where.join(' AND ')}
     ORDER BY m.StartAt DESC`,
    inputs,
  );
}

export async function createMaintenance(
  user: AuthUser,
  input: { hallId: string; title: string; description?: string; startAt: string; endAt: string },
  req: Request,
) {
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (endAt <= startAt) throw new AppError('End time must be after start time.');
  const conflict = await queryOne(
    `SELECT Id FROM dbo.bookings
     WHERE HallId = @HallId AND DeletedAt IS NULL
       AND Status NOT IN (N'CANCELLED', N'REJECTED', N'DRAFT', N'NO_SHOW')
       AND StartAt < @EndAt AND EndAt > @StartAt`,
    { HallId: input.hallId, StartAt: startAt, EndAt: endAt },
  );
  if (conflict) {
    throw new AppError('Cannot schedule maintenance over an existing booking.');
  }
  const id = await insert(
    `INSERT INTO dbo.hall_maintenance (HallId, Title, Description, StartAt, EndAt, Status, CreatedBy, UpdatedBy)
     VALUES (@HallId, @Title, @Description, @StartAt, @EndAt, N'SCHEDULED', @Actor, @Actor)`,
    {
      HallId: input.hallId,
      Title: input.title.trim(),
      Description: input.description ?? null,
      StartAt: startAt,
      EndAt: endAt,
      Actor: user.id,
    },
  );
  const now = new Date();
  if (startAt <= now && endAt > now) {
    await query(`UPDATE dbo.conference_halls SET Status = N'MAINTENANCE', UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id`, {
      Id: input.hallId,
    });
  }
  await writeAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.MAINTENANCE_CREATED,
    module: 'maintenance',
    recordId: id,
    req,
  });
  const hall = await queryOne<{ Code: string }>(`SELECT Code FROM dbo.conference_halls WHERE Id = @Id`, {
    Id: input.hallId,
  });
  getIo()?.emit(SOCKET_EVENTS.HALL_MAINTENANCE, { hallId: input.hallId, hallCode: hall?.Code, id });
  if (hall?.Code) getIo()?.to(`hall:${hall.Code}`).emit(SOCKET_EVENTS.HALL_MAINTENANCE, { id });
  return queryOne(`SELECT * FROM dbo.hall_maintenance WHERE Id = @Id`, { Id: id });
}

export async function updateMaintenance(
  user: AuthUser,
  id: string,
  input: { title?: string; description?: string; startAt?: string; endAt?: string; status?: string },
) {
  const existing = await queryOne<{ HallId: string }>(
    `SELECT HallId FROM dbo.hall_maintenance WHERE Id = @Id AND DeletedAt IS NULL`,
    { Id: id },
  );
  if (!existing) throw new AppError('Maintenance record not found.', 404);
  await query(
    `UPDATE dbo.hall_maintenance SET
        Title = COALESCE(@Title, Title),
        Description = COALESCE(@Description, Description),
        StartAt = COALESCE(@StartAt, StartAt),
        EndAt = COALESCE(@EndAt, EndAt),
        Status = COALESCE(@Status, Status),
        UpdatedAt = SYSUTCDATETIME(),
        UpdatedBy = @Actor
     WHERE Id = @Id`,
    {
      Id: id,
      Title: input.title ?? null,
      Description: input.description ?? null,
      StartAt: input.startAt ? new Date(input.startAt) : null,
      EndAt: input.endAt ? new Date(input.endAt) : null,
      Status: input.status ?? null,
      Actor: user.id,
    },
  );
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') {
    await query(
      `UPDATE dbo.conference_halls SET Status = N'AVAILABLE', UpdatedAt = SYSUTCDATETIME() WHERE Id = @HallId AND Status = N'MAINTENANCE'`,
      { HallId: existing.HallId },
    );
  }
  const hall = await queryOne<{ Code: string }>(`SELECT Code FROM dbo.conference_halls WHERE Id = @Id`, {
    Id: existing.HallId,
  });
  getIo()?.emit(SOCKET_EVENTS.HALL_MAINTENANCE, { hallId: existing.HallId, hallCode: hall?.Code, id });
  return queryOne(`SELECT * FROM dbo.hall_maintenance WHERE Id = @Id`, { Id: id });
}
