import { describe, expect, it } from 'vitest';
import { evaluateOrder } from './evaluate.js';
import { solve } from './solve.js';
import { lineTravel, loc, permutations, seededRandom, stageAt } from './test-utils.js';
import type { SolveInput } from './types.js';

describe('solve with opening hours', () => {
  it('waits for a place to open and counts the wait', () => {
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 0,
      stages: [
        stageAt('A', 10, 30, { open: 0, close: 600 }),
        stageAt('B', 20, 30, { open: 100, close: 600 }),
      ],
      travelTime: lineTravel,
    });

    // A: arrive 10, leave 40. B: arrive 50, wait until 100, leave 130. Back at 150.
    expect(result.order).toEqual(['A', 'B']);
    expect(result.visits[1]).toEqual({
      stageId: 'B',
      arrival: 50,
      serviceStart: 100,
      departure: 130,
      waited: 50,
    });
    expect(result.endArrival).toBe(150);
  });

  it('never picks an order that would end a visit after closing, if another exists', () => {
    // D listed first so a solver that ignores windows would tie-break to D, C.
    // D then C: C is reached at 60 and would end at 70, but C closes at 60.
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 0,
      stages: [stageAt('D', 10, 10), stageAt('C', 50, 10, { open: 0, close: 60 })],
      travelTime: lineTravel,
    });

    expect(result.order).toEqual(['C', 'D']);
    expect(result.endArrival).toBe(120);
  });

  it.each([1, 2, 3, 4, 5])('matches brute force over feasible orders (seed %i)', (seed) => {
    const rand = seededRandom(seed);
    const stages = Array.from({ length: 6 }, (_, i) => {
      const open = 480 + Math.floor(rand() * 200);
      return stageAt(`s${i}`, Math.floor(rand() * 100), 5 + Math.floor(rand() * 30), {
        open,
        close: open + 150 + Math.floor(rand() * 300),
      });
    });
    const input: SolveInput = {
      start: loc(Math.floor(rand() * 100)),
      end: loc(Math.floor(rand() * 100)),
      startTime: 480,
      stages,
      travelTime: lineTravel,
    };

    const feasibleEnds = permutations(stages.map((s) => s.id))
      .map((order) => evaluateOrder(input, order))
      .filter((r) =>
        r.visits.every((v) => v.departure <= stages.find((s) => s.id === v.stageId)!.window!.close),
      )
      .map((r) => r.endArrival);

    expect(feasibleEnds.length).toBeGreaterThan(0);
    expect(solve(input).endArrival).toBe(Math.min(...feasibleEnds));
  });
});
