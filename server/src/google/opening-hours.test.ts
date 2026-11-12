import { describe, expect, it } from 'vitest';
import { windowForDate, type OpeningHours } from './opening-hours.js';

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
const MONDAY = '2027-04-05';

describe('windowForDate', () => {
  const museum: OpeningHours = {
    periods: [TUE, WED, THU, FRI, SAT, SUN].map((d) => period(d, '09:00', d, '17:00')),
  };

  it('gives the opening window of that weekday, in minutes since midnight', () => {
    expect(windowForDate(museum, THURSDAY)).toEqual({ window: { open: 540, close: 1020 } });
  });

  it('says closed all day when the place has no period on that weekday (this museum is shut on Mondays)', () => {
    expect(windowForDate(museum, MONDAY)).toEqual({ closedAllDay: true });
  });

  it('uses earliest opening to latest closing when there is a lunch break (beta limit)', () => {
    const restaurant: OpeningHours = {
      periods: [period(THU, '11:30', THU, '14:30'), period(THU, '17:30', THU, '22:00')],
    };

    expect(windowForDate(restaurant, THURSDAY)).toEqual({ window: { open: 690, close: 1320 } });
  });

  it('cuts a place that closes after midnight at the end of the day, and continues it the next day', () => {
    const bar: OpeningHours = { periods: [period(FRI, '18:00', SAT, '02:00')] };

    expect(windowForDate(bar, FRIDAY)).toEqual({ window: { open: 1080, close: 1440 } });
    expect(windowForDate(bar, SATURDAY)).toEqual({ window: { open: 0, close: 120 } });
    expect(windowForDate(bar, THURSDAY)).toEqual({ closedAllDay: true });
  });

  it('treats closing exactly at midnight as the end of the day', () => {
    const late: OpeningHours = { periods: [period(THU, '10:00', FRI, '00:00')] };

    expect(windowForDate(late, THURSDAY)).toEqual({ window: { open: 600, close: 1440 } });
  });

  it('sees a place that is open around the clock as always open', () => {
    const always: OpeningHours = { periods: [{ open: at(SUN, '00:00') }] };

    expect(windowForDate(always, THURSDAY)).toEqual({});
  });

  it.each([null, undefined, {}, { periods: [] }])(
    'adds no limit when Google gave no opening hours (%j)',
    (hours) => {
      expect(windowForDate(hours as OpeningHours | null | undefined, THURSDAY)).toEqual({});
    },
  );

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => windowForDate(museum, '04/01/2027')).toThrow(/date/i);
  });
});
