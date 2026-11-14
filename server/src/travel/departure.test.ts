import { describe, expect, it } from 'vitest';
import { departureInstant } from './departure.js';

const TOKYO = { lat: 35.68, lng: 139.76 };
const JERUSALEM = { lat: 31.77, lng: 35.21 };
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

describe('departureInstant', () => {
  it("turns the day's local clock time into the exact moment, using the place's time zone", () => {
    // Tokyo is UTC+9 all year.
    expect(departureInstant({ date: '2027-04-01', minutes: 540, at: TOKYO, now: LONG_AGO })).toBe(
      '2027-04-01T00:00:00.000Z',
    );
  });

  it('follows daylight saving time: Jerusalem is UTC+3 in April and UTC+2 in January', () => {
    expect(
      departureInstant({ date: '2027-04-15', minutes: 540, at: JERUSALEM, now: LONG_AGO }),
    ).toBe('2027-04-15T06:00:00.000Z');
    expect(
      departureInstant({ date: '2027-01-15', minutes: 540, at: JERUSALEM, now: LONG_AGO }),
    ).toBe('2027-01-15T07:00:00.000Z');
  });

  it('handles times after midnight (a day that runs late)', () => {
    expect(departureInstant({ date: '2027-04-01', minutes: 1500, at: TOKYO, now: LONG_AGO })).toBe(
      '2027-04-01T16:00:00.000Z',
    );
  });

  it('never asks Google about the past: a moment that has gone becomes just after now', () => {
    const now = new Date('2027-04-01T12:00:00Z');

    expect(departureInstant({ date: '2027-04-01', minutes: 540, at: TOKYO, now })).toBe(
      '2027-04-01T12:02:00.000Z',
    );
  });
});
