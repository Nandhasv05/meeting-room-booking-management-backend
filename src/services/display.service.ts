// AUTHOR : NANDHAKUMAR S V
// VERSION : 1.0.0
// DESCRIPTION : Display service
// DATE : 2026-08-26
import { query, queryOne } from '../config/database.js';
import { getClientApiNow } from '../config/clientApi.js';
import { getHallByCode } from './hall.service.js';
import { BOOKING_SELECT, omitQr, type BookingRow } from '../types/db.js';

export type DisplayState = 'AVAILABLE' | 'UPCOMING' | 'ONGOING' | 'MAINTENANCE';

/** Get display */
export async function getDisplay(hallCode: string) {
  const hall = await getHallByCode(hallCode);
  const now = await getClientApiNow();
  const clock = { HallId: hall.Id, Now: now };

  /** Maintenance */
  const maintenance = await queryOne<{ Title: string; EndAt: Date }>(
    `SELECT Title, EndAt FROM dbo.hall_maintenance
     WHERE HallId = @HallId AND DeletedAt IS NULL
       AND Status IN (N'SCHEDULED', N'IN_PROGRESS')
       AND StartAt <= @Now AND EndAt > @Now`,
    clock,
  );

  /** Maintenance */
if (hall.Status === 'BLOCKED' || hall.Status === 'MAINTENANCE' || maintenance) {
    return {
      hallName: hall.Name,
      hallCode: hall.Code,
      state: 'MAINTENANCE' as DisplayState,
      subtitle: 'NOT AVAILABLE',
      headline: 'UNDER MAINTENANCE',
      availableFrom: maintenance?.EndAt ?? null,
      current: null,
      next: null,
      serverNow: now.toISOString(),
    };
  }

  /** Current */
  const current = await queryOne<BookingRow>(
    `${BOOKING_SELECT}
     WHERE b.HallId = @HallId AND b.DeletedAt IS NULL
       AND b.Status IN (N'ONGOING', N'CONFIRMED', N'APPROVED')
       AND b.StartAt <= @Now AND b.EndAt > @Now`,
    clock,
  );

  /** Next */
  const next = await queryOne<BookingRow>(
    `${BOOKING_SELECT}
     WHERE b.HallId = @HallId AND b.DeletedAt IS NULL
       AND b.Status IN (N'CONFIRMED', N'APPROVED', N'PENDING', N'ONGOING')
       AND b.StartAt > @Now
     ORDER BY b.StartAt OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY`,
    clock,
  );

  /** Ongoing */
  if (current) {
    const ongoing = current.Status === 'ONGOING' || now >= new Date(current.StartAt);
    if (ongoing) {
      return {
        hallName: hall.Name,
        hallCode: hall.Code,
        state: 'ONGOING' as DisplayState,
        subtitle: 'EVENT IN PROGRESS',
        headline: current.EventName,
        availableFrom: null,
        current: omitQr(current),
        next: next ? omitQr(next) : null,
        serverNow: now.toISOString(),
      };
    }
  }

  /** Soon */
  if (next) {
    const soon = new Date(next.StartAt).getTime() - now.getTime() < 4 * 60 * 60 * 1000;
    if (soon || new Date(next.StartAt).toDateString() === now.toDateString()) {
      return {
        hallName: hall.Name,
        hallCode: hall.Code,
        state: 'UPCOMING' as DisplayState,
        subtitle: 'UPCOMING EVENT',
        headline: next.EventName,
        availableFrom: null,
        current: null,
        next: next ? omitQr(next) : null,
        serverNow: now.toISOString(),
      };
    }
  }

  /** Available */
  return {
    hallName: hall.Name,
    hallCode: hall.Code,
    state: 'AVAILABLE' as DisplayState,
    subtitle: 'AVAILABLE',
    headline: 'No upcoming event',
    availableFrom: null,
    current: null,
    next: next ? omitQr(next) : null,
    serverNow: now.toISOString(),
  };
}
