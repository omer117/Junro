import { describe, expect, it } from 'vitest';
import { windowsForDate, type OpeningHours } from './opening-hours.js';

// Google's weekdays: 0 = Sunday ... 6 = Saturday.
const SUN = 0,
  TUE = 2,
  WED = 3,
  THU = 4,
  FRI = 5,
  SAT = 6;

const at = (day: number, time: string) => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return { day, hour, minute };
};
const period = (openDay: number, open: string, closeDay: number, close: string) => ({
  open: at(openDay, open),
  close: at(closeDay, close),
});

// 2027-04-01 is a Thursday.
const THURSDAY = '2027-04-01';
const FRIDAY = '2027-04-02';
const SATURDAY = '2027-04-03';
const SUNDAY = '2027-04-04';
const MONDAY = '2027-04-05';

describe('windowsForDate', () => {
  const museum: OpeningHours = {
    periods: [TUE, WED, THU, FRI, SAT, SUN].map((d) => period(d, '09:00', d, '17:00')),
  };

  it('gives the opening window of that weekday, in minutes since midnight', () => {
    expect(windowsForDate(museum, THURSDAY)).toEqual({ windows: [{ open: 540, close: 1020 }] });
  });

  it('says closed all day when the place has no period on that weekday (this museum is shut on Mondays)', () => {
    expect(windowsForDate(museum, MONDAY)).toEqual({ closedAllDay: true });
  });

  it('keeps a lunch break as two windows', () => {
    const restaurant: OpeningHours = {
      periods: [period(THU, '17:30', THU, '22:00'), period(THU, '11:30', THU, '14:30')],
    };

    expect(windowsForDate(restaurant, THURSDAY)).toEqual({
      windows: [
        { open: 690, close: 870 },
        { open: 1050, close: 1320 },
      ],
    });
  });

  it('lets a place that closes after midnight run past 24:00, and gives the tail to the next day', () => {
    const bar: OpeningHours = { periods: [period(FRI, '18:00', SAT, '02:00')] };

    expect(windowsForDate(bar, FRIDAY)).toEqual({ windows: [{ open: 1080, close: 1560 }] });
    expect(windowsForDate(bar, SATURDAY)).toEqual({ windows: [{ open: 0, close: 120 }] });
    expect(windowsForDate(bar, THURSDAY)).toEqual({ closedAllDay: true });
  });

  it('wraps the week: Saturday night into Sunday', () => {
    const club: OpeningHours = { periods: [period(SAT, '22:00', SUN, '03:00')] };

    expect(windowsForDate(club, SATURDAY)).toEqual({ windows: [{ open: 1320, close: 1620 }] });
    expect(windowsForDate(club, SUNDAY)).toEqual({ windows: [{ open: 0, close: 180 }] });
  });

  it('wraps the week the other way: Sunday opening has its tail from Saturday', () => {
    const late: OpeningHours = {
      periods: [period(SUN, '10:00', SUN, '12:00'), period(SAT, '23:00', SUN, '01:00')],
    };

    expect(windowsForDate(late, SUNDAY)).toEqual({
      windows: [
        { open: 0, close: 60 },
        { open: 600, close: 720 },
      ],
    });
  });

  it('merges periods that touch or overlap', () => {
    const touching: OpeningHours = {
      periods: [period(THU, '09:00', THU, '12:00'), period(THU, '12:00', THU, '15:00')],
    };

    expect(windowsForDate(touching, THURSDAY)).toEqual({ windows: [{ open: 540, close: 900 }] });
  });

  it('keeps a tail of last night and tonight as two windows when they are apart', () => {
    const bar: OpeningHours = {
      periods: [period(THU, '20:00', FRI, '01:00'), period(FRI, '20:00', SAT, '01:00')],
    };

    expect(windowsForDate(bar, FRIDAY)).toEqual({
      windows: [
        { open: 0, close: 60 },
        { open: 1200, close: 1500 },
      ],
    });
  });

  it('treats closing exactly at midnight as the end of the day, with nothing on the next', () => {
    const late: OpeningHours = { periods: [period(THU, '10:00', FRI, '00:00')] };

    expect(windowsForDate(late, THURSDAY)).toEqual({ windows: [{ open: 600, close: 1440 }] });
    expect(windowsForDate(late, FRIDAY)).toEqual({ closedAllDay: true });
  });

  it('sees a place that is open around the clock as always open', () => {
    const always: OpeningHours = { periods: [{ open: at(SUN, '00:00') }] };

    expect(windowsForDate(always, THURSDAY)).toEqual({});
  });

  it.each([null, undefined, {}, { periods: [] }])(
    'adds no limit when Google gave no opening hours (%j)',
    (hours) => {
      expect(windowsForDate(hours as OpeningHours | null | undefined, THURSDAY)).toEqual({});
    },
  );

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => windowsForDate(museum, '04/01/2027')).toThrow(/date/i);
  });
});
