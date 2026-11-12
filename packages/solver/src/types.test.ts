import { describe, expect, it } from 'vitest';
import type { SolveInput, Stage } from './index.js';
import { lineTravel, loc, stageAt } from './test-utils.js';

describe('test utils', () => {
  it('lineTravel is the distance on the line, in minutes', () => {
    expect(lineTravel(loc(0), loc(5), 0)).toBe(5);
    expect(lineTravel(loc(5), loc(0), 0)).toBe(5);
  });

  it('stageAt builds a stage with an optional window', () => {
    const plain: Stage = stageAt('A', 10, 30);
    expect(plain).toEqual({ id: 'A', location: loc(10), stayMinutes: 30 });

    const timed = stageAt('B', 20, 15, { open: 540, close: 1020 });
    expect(timed.window).toEqual({ open: 540, close: 1020 });
  });
});

describe('types', () => {
  it('a SolveInput can be built from the public types', () => {
    const input = {
      start: loc(0),
      end: loc(0),
      startTime: 540,
      stages: [stageAt('A', 10, 30), stageAt('B', 20, 15)],
      travelTime: lineTravel,
    } satisfies SolveInput;

    expect(input.stages).toHaveLength(2);
  });
});
