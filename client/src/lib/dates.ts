const DAY_MS = 24 * 60 * 60 * 1000;

/** A 'YYYY-MM-DD' date as a UTC timestamp. Working in UTC keeps daylight saving out of it. */
function utc(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/** Whole days from `today` to `date` (negative when `date` has passed). Both 'YYYY-MM-DD'. */
export function daysUntil(date: string, today: string): number {
  return Math.round((utc(date) - utc(today)) / DAY_MS);
}

const part = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(utc(date));

export const formatMonthAbbr = (date: string) => part(date, { month: 'short' });

export const formatDayNumber = (date: string) => part(date, { day: '2-digit' });

/** "Thu, Apr 1" */
export const formatDayTitle = (date: string) =>
  `${part(date, { weekday: 'short' })}, ${part(date, { month: 'short' })} ${part(date, { day: 'numeric' })}`;

/** Minutes since midnight as a clock time: 1180 becomes "19:40". Past midnight wraps round. */
export function formatClock(minutes: number): string {
  const total = Math.round(minutes) % 1440;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${hours}:${String(rest).padStart(2, '0')}`;
}

/** Today's date on this device, as 'YYYY-MM-DD'. */
export function todayString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
