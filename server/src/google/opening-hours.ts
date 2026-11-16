import type { Stage } from '@junro/solver';
import type { OpeningHours } from './types.js';

export type { OpeningHours };

/** The solver-facing part of a stage that comes from opening hours. */
export type HoursForDay = Pick<Stage, 'windows' | 'closedAllDay'>;

const DAY = 1440;

/**
 * Turns Google's weekly opening hours into what the solver needs for one date:
 *   {}                      always open, or Google has no hours for it (no limit)
 *   { closedAllDay: true }  nothing open on that date
 *   { windows }             the opening windows, sorted and apart, in minutes since midnight
 *
 * A lunch break gives two windows. A place that closes after midnight keeps running past 1440
 * on the day it opened (a bar open 18:00-02:00 is { open: 1080, close: 1560 }), and its tail
 * shows up as { open: 0, close: 120 } on the next day.
 *
 * Times are the place's local time, the same clock as the trip day: no time zones here.
 */
export function windowsForDate(hours: OpeningHours | null | undefined, date: string): HoursForDay {
  const weekday = weekdayOf(date);
  const periods = hours?.periods ?? [];
  if (periods.length === 0) return {};

  const spans: Array<[number, number]> = [];

  for (const { open, close } of periods) {
    // Google leaves out `close` for a place that never closes.
    if (!close) return {};

    const opens = open.hour * 60 + open.minute;
    const closes = close.hour * 60 + close.minute;
    // Whole days between the opening day and the closing day (Saturday -> Sunday wraps).
    const length = mod7(close.day - open.day) * DAY + closes - opens;
    if (length <= 0) continue;

    // The period may have started this week or last week; try both. Positions are minutes from
    // midnight of `date` (negative = before it).
    const thisWeek = mod7(open.day - weekday) * DAY + opens;
    for (const start of [thisWeek, thisWeek - 7 * DAY]) {
      const end = start + length;
      // Keep what overlaps this date. Cut the start at midnight, never the end.
      if (end > 0 && start < DAY) spans.push([Math.max(0, start), end]);
    }
  }

  spans.sort((a, b) => a[0] - b[0]);
  const windows: Array<{ open: number; close: number }> = [];
  for (const [from, to] of spans) {
    const last = windows[windows.length - 1];
    if (last && from <= last.close) last.close = Math.max(last.close, to);
    else windows.push({ open: from, close: to });
  }

  return windows.length === 0 ? { closedAllDay: true } : { windows };
}

const mod7 = (n: number) => ((n % 7) + 7) % 7;

/** 0 = Sunday ... 6 = Saturday, like Google. Computed in UTC so the machine's time zone never matters. */
function weekdayOf(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD, got ${date}`);
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) throw new Error(`date is not a real date: ${date}`);
  return day.getUTCDay();
}
