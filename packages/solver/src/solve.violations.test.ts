import { describe, expect, it } from 'vitest';
import { evaluateOrder } from './evaluate.js';
import { solve } from './solve.js';
import { lineTravel, loc, permutations, seededRandom, stageAt } from './test-utils.js';
import type { SolveInput } from './types.js';

describe('solve when not everything fits', () => {
  it('keeps every stage and flags the one that has to be late', () => {
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 0,
      stages: [
        stageAt('X', 10, 30, { open: 0, close: 50 }),
        stageAt('Y', 20, 30, { open: 0, close: 50 }),
      ],
      travelTime: lineTravel,
    });

    // X then Y: X leaves at 40 (ok), Y arrives 50, leaves 80 -> 30 late.
    // Y then X: Y leaves at 50 (ok), X arrives 60, leaves 90 -> 40 late.
    expect(result.order).toEqual(['X', 'Y']);
    expect(result.violations).toEqual([{ stageId: 'Y', kind: 'closed', minutesLate: 30 }]);
    expect(result.totalLateness).toBe(30);
  });

  it('flags every stage when the day starts after all of them closed', () => {
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 700,
      stages: [
        stageAt('A', 10, 10, { open: 0, close: 600 }),
        stageAt('B', 20, 10, { open: 0, close: 600 }),
      ],
      travelTime: lineTravel,
    });

    // A then B: 120 + 140 = 260 late. B then A: 130 + 150 = 280 late.
    expect(result.order).toEqual(['A', 'B']);
    expect(result.violations.map((v) => v.stageId)).toEqual(['A', 'B']);
    expect(result.totalLateness).toBe(260);
  });

  it('reports window_too_short when the stay is longer than the opening window', () => {
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 590,
      stages: [stageAt('T', 10, 90, { open: 600, close: 660 })],
      travelTime: lineTravel,
    });

    // Arrive 600, leave 690: 30 late no matter what order or start time.
    expect(result.violations).toEqual([{ stageId: 'T', kind: 'window_too_short' }]);
    expect(result.totalLateness).toBe(30);
  });

  it('has no violations when everything fits', () => {
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 0,
      stages: [stageAt('A', 10, 10, { open: 0, close: 600 })],
      travelTime: lineTravel,
    });

    expect(result.violations).toEqual([]);
    expect(result.totalLateness).toBe(0);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'minimises (lateness, end time) exactly, brute force (seed %i)',
    (seed) => {
      const rand = seededRandom(seed);
      // Tight windows so lateness is common.
      const stages = Array.from({ length: 6 }, (_, i) => {
        const open = 480 + Math.floor(rand() * 60);
        return stageAt(`s${i}`, Math.floor(rand() * 100), 10 + Math.floor(rand() * 30), {
          open,
          close: open + 20 + Math.floor(rand() * 120),
        });
      });
      const input: SolveInput = {
        start: loc(Math.floor(rand() * 100)),
        end: loc(Math.floor(rand() * 100)),
        startTime: 480,
        stages,
        travelTime: lineTravel,
      };

      const scores = permutations(stages.map((s) => s.id)).map((order) => {
        const r = evaluateOrder(input, order);
        return [r.totalLateness, r.endArrival] as const;
      });
      scores.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

      const result = solve(input);
      expect([result.totalLateness, result.endArrival]).toEqual(scores[0]);
      expect(result.order).toHaveLength(stages.length);
    },
  );
});
