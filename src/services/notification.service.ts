import { query, queryOne, insert } from '../config/database.js';
import { getIo } from '../sockets/registry.js';
import { SOCKET_EVENTS } from '../config/constants.js';
import { logger } from '../config/logger.js';
import type { AuthUser } from '../types/index.js';

export type NotificationType =
  | 'BOOKING_CREATED'
  | 'BOOKING_APPROVED'
  | 'BOOKING_REJECTED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_REMINDER'
  | 'EVENT_STARTING'
  | 'EVENT_COMPLETED'
  | 'BOOKING_EXTENDED';

export async function notify(input: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedModule?: string;
  relatedId?: string;
}): Promise<void> {
  const id = await insert(
    `INSERT INTO dbo.notifications (UserId, Type, Title, Message, RelatedModule, RelatedId, CreatedAt)
     VALUES (@UserId, @Type, @Title, @Message, @RelatedModule, @RelatedId, SYSUTCDATETIME())`,
    {
      UserId: input.userId,
      Type: input.type,
      Title: input.title,
      Message: input.message,
      RelatedModule: input.relatedModule ?? null,
      RelatedId: input.relatedId ?? null,
    },
  );
  getIo()?.to(`user:${input.userId}`).emit(SOCKET_EVENTS.NOTIFICATION, { id, ...input });
}

export async function notifyMany(
  userIds: string[],
  payload: Omit<Parameters<typeof notify>[0], 'userId'>,
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  await Promise.all(unique.map((userId) => notify({ ...payload, userId })));
}

export async function listNotifications(user: AuthUser, unreadOnly = false) {
  try {
    return await query(
      `SELECT Id, Type, Title, Message, IsRead, RelatedModule, RelatedId, CreatedAt
       FROM dbo.notifications
       WHERE UserId = @UserId ${unreadOnly ? 'AND IsRead = 0' : ''}
       ORDER BY CreatedAt DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`,
      { UserId: user.id },
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'listNotifications failed');
    return [];
  }
}

export async function markRead(user: AuthUser, id: string): Promise<void> {
  await query(`UPDATE dbo.notifications SET IsRead = 1 WHERE Id = @Id AND UserId = @UserId`, {
    Id: id,
    UserId: user.id,
  });
}

export async function markAllRead(user: AuthUser): Promise<void> {
  await query(`UPDATE dbo.notifications SET IsRead = 1 WHERE UserId = @UserId AND IsRead = 0`, {
    UserId: user.id,
  });
}

export async function unreadCount(user: AuthUser): Promise<number> {
  try {
    const row = await queryOne<{ Cnt: number }>(
      `SELECT COUNT(*) AS Cnt FROM dbo.notifications WHERE UserId = @UserId AND IsRead = 0`,
      { UserId: user.id },
    );
    return row?.Cnt ?? 0;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'unreadCount failed');
    return 0;
  }
}

export { sendEmail } from './email.service.js';
