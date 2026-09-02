/** App calendar day for India (matches CLIENT_API_LIVE GETDATE). */
export const APP_TIME_ZONE = 'Asia/Kolkata';

function pad2(n: string | number): string {
  return String(n).padStart(2, '0');
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes, fallback = '00'): string {
  return parts.find((p) => p.type === type)?.value ?? fallback;
}

/** Calendar date (YYYY-MM-DD) in the app timezone. */
export function dateInAppTz(value: Date, timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function todayInAppTz(timeZone = APP_TIME_ZONE): string {
  return dateInAppTz(new Date(), timeZone);
}

/** Wall-clock HH:MM:SS in the app timezone — never the Node host timezone. */
export function clockInAppTz(value: Date, timeZone = APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const hour = part(parts, 'hour');
  return `${hour === '24' ? '00' : pad2(hour)}:${pad2(part(parts, 'minute'))}:${pad2(part(parts, 'second'))}`;
}

/**
 * Hall OpeningTime/ClosingTime may arrive as varchar (CONVERT), a Date
 * (mssql TIME), or an ISO string. Never scrape HH:MM out of a datetime
 * (that would read 02:30 from 1970-01-01T02:30:00.000Z instead of 08:00 IST).
 */
export function asClock(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return clockInAppTz(value);
  }
  const text = String(value ?? '').trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    const [h, m, s] = text.split(':');
    return `${pad2(h ?? '00')}:${m ?? '00'}:${s ?? '00'}`;
  }
  if (/T/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return clockInAppTz(parsed);
  }
  return '00:00:00';
}
