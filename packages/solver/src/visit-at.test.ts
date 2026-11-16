import { describe, expect, it } from 'vitest';
import { visitAt } from './evaluate.js';
import { loc } from './test-utils.js';
import type { Stage, TimeWindow } from './types.js';

// Lunch place: open 11:30-14:30 and 17:30-22:00.
const lunch: TimeWindow[] = [
  { open: 690, close: 870 },
  { open: 1050, close: 1320 },
];
const place = (stay: number, windows?: TimeWindow[]): Stage => ({
  id: 'p',
  location: loc(0),
  stayMinutes: stay,
  ...(windows ? { windows } : {}),
});

describe('visitAt: which opening window a visit uses', () => {
  it('has no limit without windows', () => {
    expect(visitAt(place(30), 100)).toEqual({
      serviceStart: 100,
      departure: 130,
      lateness: 0,
      windowIndex: -1,
    });
  });

  it('uses the first window when the stay fits in it', () => {
    expect(visitAt(place(60, lunch), 700)).toMatchObject({
      serviceStart: 700,
      departure: 760,
      lateness: 0,
      windowIndex: 0,
    });
  });

  it('waits for the opening when early', () => {
    expect(visitAt(place(60, lunch), 600)).toMatchObject({ serviceStart: 690, windowIndex: 0 });
  });

  it('waits for the second window when it arrives in the break', () => {
    // 15:10 arrival, the first window closed at 14:30.
    expect(visitAt(place(60, lunch), 910)).toMatchObject({
      serviceStart: 1050,
      departure: 1110,
      lateness: 0,
      windowIndex: 1,
    });
  });

  it('plans for the second window when the stay does not fit before the first closing', () => {
    // 14:00 arrival, 60 min stay: would end 15:00, after the 14:30 closing.
    expect(visitAt(place(60, lunch), 840)).toMatchObject({
      serviceStart: 1050,
      lateness: 0,
      windowIndex: 1,
    });
  });

  it('uses the only window that is long enough for the stay', () => {
    const museum = [
      { open: 540, close: 600 },
      { open: 700, close: 1000 },
    ];
    expect(visitAt(place(120, museum), 540)).toMatchObject({ serviceStart: 700, windowIndex: 1 });
  });

  it('is late in the last window when it arrives after everything closed', () => {
    expect(visitAt(place(30, lunch), 1400)).toMatchObject({
      serviceStart: 1400,
      departure: 1430,
      lateness: 110,
      windowIndex: 1,
    });
  });

  it('picks the least late window when no window fits, the earlier one on a tie', () => {
    const tight = [
      { open: 600, close: 620 },
      { open: 700, close: 720 },
    ];
    // stay 30: late 10 in either window; tie goes to the first.
    expect(visitAt(place(30, tight), 590)).toMatchObject({ lateness: 10, windowIndex: 0 });
  });

  it('ignores windows for a place closed all day', () => {
    expect(visitAt({ ...place(30, lunch), closedAllDay: true }, 900)).toMatchObject({
      serviceStart: 900,
      lateness: 0,
    });
  });

  it('never gets earlier or less late when it arrives later (what keeps the DP exact)', () => {
    const sets: TimeWindow[][] = [
      lunch,
      [
        { open: 100, close: 140 },
        { open: 200, close: 400 },
        { open: 450, close: 460 },
      ],
      [
        { open: 0, close: 50 },
        { open: 60, close: 70 },
      ],
      [{ open: 1080, close: 1560 }],
    ];
    for (const windows of sets) {
      for (const stay of [0, 5, 20, 45, 90, 200]) {
        let previous = visitAt(place(stay, windows), 0);
        for (let arrival = 1; arrival <= 1700; arrival++) {
          const now = visitAt(place(stay, windows), arrival);
          expect(now.departure).toBeGreaterThanOrEqual(previous.departure);
          expect(now.lateness).toBeGreaterThanOrEqual(previous.lateness);
          previous = now;
        }
      }
    }
  });
});
