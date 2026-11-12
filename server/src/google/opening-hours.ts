import type { Stage } from '@junro/solver';
import type { OpeningHours } from './types.js';

export type { OpeningHours };

/** The solver-facing part of a stage that comes from opening hours. */
export type HoursForDay = Pick<Stage, 'window' | 'closedAllDay'>;

const END_OF_DAY = 1440;

/**
 * Turns Google's weekly opening hours into what the solver needs for one date:
 *   {}                      always open, or Google has no hours for it (no limit)
 *   { closedAllDay: true }  no opening on that weekday
 *   { window }              open from `open` to `close`, in minutes since midnight
 *
 * Beta keeps ONE window per day: earliest opening to latest closing, so a lunch break is
 * ignored (several windows are a post-beta feature). A place that closes after midnight is
 * cut at the end of that day and continues from 00:00 on the next one.
 *
 * Times are the place's local time, the same clock as the trip day: no time zones here.
 */
export function windowForDate(hours: OpeningHours | null | undefined, date: string): HoursForDay {
  const weekday = weekdayOf(date);
  const periods = hours?.periods ?? [];
  if (periods.length === 0) return {};

  const yesterday = (weekday + 6) % 7;
  const spans: Array<[number, number]> = [];

  for (const { open, close } of periods) {
    // Google leaves out `close` for a place that never closes.
    if (!close) return {};

    const opens = open.hour * 60 + open.minute;
    const closes = close.hour * 60 + close.minute;

    if (open.day === weekday) {
      spans.push([opens, close.day === weekday ? closes : END_OF_DAY]);
    }
    if (open.day === yesterday && close.day === weekday) {
      spans.push([0, closes]); // the tail of last night's opening
    }
  }

  const real = spans.filter(([from, to]) => to > from);
  if (real.length === 0) return { closedAllDay: true };

  return {
    window: {
      open: Math.min(...real.map(([from]) => from)),
      close: Math.max(...real.map(([, to]) => to)),
    },
  };
}

/** 0 = Sunday ... 6 = Saturday, like Google. Computed in UTC so the machine's time zone never matters. */
function weekdayOf(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD, got ${date}`);
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) throw new Error(`date is not a real date: ${date}`);
  return day.getUTCDay();
}
