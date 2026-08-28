// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Scheduler
// DATE : 2026-08-26
import { logger } from '../config/logger.js';
import { transitionDueBookings } from '../services/booking.service.js';
import { query } from '../config/database.js';
import { notify } from '../services/notification.service.js';
import { getSetting } from '../services/settings.service.js';

/** Start scheduler */
export function startScheduler(): void {
  const tick = async () => {
    try {
      await transitionDueBookings();
      const minutes = Number((await getSetting('booking.reminder_minutes')) ?? 15);
      const due = await query<{ Id: string; EventName: string; OrganizerId: string; HallName: string }>(
        `SELECT b.Id, b.EventName, b.OrganizerId, h.Name AS HallName
         FROM dbo.bookings b
         JOIN dbo.conference_halls h ON h.Id = b.HallId
         WHERE b.DeletedAt IS NULL AND b.Status IN (N'CONFIRMED', N'APPROVED')
           AND b.StartAt BETWEEN SYSUTCDATETIME() AND DATEADD(MINUTE, @Minutes, SYSUTCDATETIME())
           AND NOT EXISTS (
             SELECT 1 FROM dbo.notifications n
             WHERE n.RelatedId = b.Id AND n.Type = N'BOOKING_REMINDER'
           )`,
        { Minutes: minutes },
      );
      for (const row of due) {
        await notify({
          userId: row.OrganizerId,
          type: 'BOOKING_REMINDER',
          title: 'Event reminder',
          message: `${row.EventName} starts soon in ${row.HallName}.`,
          relatedModule: 'bookings',
          relatedId: row.Id,
        });
      }
    } catch (err) {
      logger.error({ err }, 'scheduler tick failed');
    }
  };
  void tick();
  setInterval(() => void tick(), 60_000);
}
