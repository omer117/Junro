import { describe, expect, it } from 'vitest';
import { InvalidInputError, solve } from '../index.js';
import { lineTravel, loc } from './test-utils.js';
import type { TimeWindow } from '../types.js';

const solveWith = (windows: TimeWindow[]) =>
  solve({
    start: loc(0),
    end: loc(0),
    startTime: 540,
    stages: [{ id: 'a', location: loc(5), stayMinutes: 10, windows }],
    travelTime: lineTravel,
  });

describe('validation of opening windows', () => {
  it('rejects an empty list', () => {
    expect(() => solveWith([])).toThrow(InvalidInputError);
  });
  it('rejects a window that closes when it opens', () => {
    expect(() => solveWith([{ open: 600, close: 600 }])).toThrow(InvalidInputError);
  });
  it('rejects unsorted windows', () => {
    expect(() =>
      solveWith([
        { open: 800, close: 900 },
        { open: 600, close: 700 },
      ]),
    ).toThrow(InvalidInputError);
  });
  it('rejects overlapping and touching windows', () => {
    expect(() =>
      solveWith([
        { open: 600, close: 700 },
        { open: 650, close: 800 },
      ]),
    ).toThrow(InvalidInputError);
    expect(() =>
      solveWith([
        { open: 600, close: 700 },
        { open: 700, close: 800 },
      ]),
    ).toThrow(InvalidInputError);
  });
  it('accepts separate windows', () => {
    expect(() =>
      solveWith([
        { open: 600, close: 700 },
        { open: 800, close: 900 },
      ]),
    ).not.toThrow();
  });
});
