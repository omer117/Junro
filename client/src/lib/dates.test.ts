import { describe, expect, it } from 'vitest';
import { daysUntil, formatClock, formatDayTitle, formatMonthAbbr, formatDayNumber } from './dates';

describe('dates', () => {
  it('counts whole days between two calendar dates', () => {
    expect(daysUntil('2027-04-01', '2026-11-13')).toBe(139);
    expect(daysUntil('2026-11-14', '2026-11-13')).toBe(1);
    expect(daysUntil('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysUntil('2026-11-10', '2026-11-13')).toBe(-3);
  });

  it('does not depend on daylight saving time', () => {
    // Clocks change in Israel and Japan within these ranges; whole days must stay whole.
    expect(daysUntil('2027-04-01', '2027-03-25')).toBe(7);
    expect(daysUntil('2026-10-30', '2026-10-24')).toBe(6);
  });

  it('writes a date for people, without shifting it by the time zone', () => {
    expect(formatMonthAbbr('2027-04-01')).toBe('Apr');
    expect(formatDayNumber('2027-04-01')).toBe('01');
    expect(formatDayTitle('2027-04-01')).toBe('Thu, Apr 1');
    expect(formatDayTitle('2027-12-31')).toBe('Fri, Dec 31');
  });

  it('writes minutes since midnight as a clock time', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(540)).toBe('9:00');
    expect(formatClock(1180)).toBe('19:40');
    expect(formatClock(752.17)).toBe('12:32');
    expect(formatClock(1440 + 30)).toBe('0:30');
  });
});
