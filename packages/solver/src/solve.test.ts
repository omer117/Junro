import { describe, expect, it } from 'vitest';
import { evaluateOrder } from './evaluate.js';
import { solve } from './solve.js';
import { lineTravel, loc, permutations, seededRandom, stageAt } from './test-utils.js';
import type { SolveInput } from './types.js';

describe('solve (no opening hours)', () => {
  it('visits stages in the order that makes a round trip shortest', () => {
    const result = solve({
      start: loc(0),
      end: loc(0),
      startTime: 0,
      stages: [stageAt('far', 30, 10), stageAt('near', 10, 10), stageAt('mid', 20, 10)],
      travelTime: lineTravel,
    });

    expect(result.order).toEqual(['near', 'mid', 'far']);
    // 30 minutes out + 30 back + 3 stays of 10
    expect(result.endArrival).toBe(90);
  });

  it('heads toward the end point when start and end differ', () => {
    const result = solve({
      start: loc(0),
      end: loc(100),
      startTime: 0,
      stages: [stageAt('c', 90, 10), stageAt('a', 10, 10), stageAt('b', 50, 10)],
      travelTime: lineTravel,
    });

    expect(result.order).toEqual(['a', 'b', 'c']);
    expect(result.endArrival).toBe(130);
  });

  it.each([1, 2, 3, 4, 5])('matches brute force over all orders (seed %i)', (seed) => {
    const rand = seededRandom(seed);
    const stages = Array.from({ length: 6 }, (_, i) =>
      stageAt(`s${i}`, Math.floor(rand() * 100), 5 + Math.floor(rand() * 40)),
    );
    const input: SolveInput = {
      start: loc(Math.floor(rand() * 100)),
      end: loc(Math.floor(rand() * 100)),
      startTime: 480,
      stages,
      travelTime: lineTravel,
    };

    const best = Math.min(
      ...permutations(stages.map((s) => s.id)).map(
        (order) => evaluateOrder(input, order).endArrival,
      ),
    );
    const result = solve(input);

    expect(result.endArrival).toBe(best);
    expect([...result.order].sort()).toEqual(stages.map((s) => s.id).sort());
  });

  it('uses the real departure time when travel time depends on it', () => {
    // Anything leaving at or after 600 takes 20 extra minutes (e.g. rush hour).
    const rushHour: SolveInput['travelTime'] = (from, to, departureTime) =>
      lineTravel(from, to, departureTime) + (departureTime >= 600 ? 20 : 0);
    const input: SolveInput = {
      start: loc(0),
      end: loc(0),
      startTime: 590,
      stages: [stageAt('A', 10, 5)],
      travelTime: rushHour,
    };

    // 590 -> arrive 600, stay until 605, then leave in rush hour: 10 + 20 back.
    expect(solve(input).endArrival).toBe(635);
  });
});
