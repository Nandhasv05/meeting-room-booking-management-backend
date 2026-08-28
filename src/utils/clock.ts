/** App calendar day for India (matches CLIENT_API_LIVE GETDATE). */
export const APP_TIME_ZONE = 'Asia/Kolkata';

export function todayInAppTz(timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
