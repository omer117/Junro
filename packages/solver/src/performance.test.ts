import { describe, expect, it } from 'vitest';
import { solve } from './solve.js';
import { lineTravel, loc, seededRandom, stageAt } from './test-utils.js';
import type { SolveInput } from './types.js';

function randomDay(count: number, seed: number): SolveInput {
  const rand = seededRandom(seed);
  const stages = Array.from({ length: count }, (_, i) => {
    const open = 480 + Math.floor(rand() * 240);
    return stageAt(`s${i}`, Math.floor(rand() * 120), 20 + Math.floor(rand() * 40), {
      open,
      close: open + 180 + Math.floor(rand() * 300),
    });
  });
  return { start: loc(0), end: loc(0), startTime: 480, stages, travelTime: lineTravel };
}

describe('performance', () => {
  it('solves a 12-stage day with opening hours in under 1 second', () => {
    const started = performance.now();
    const result = solve(randomDay(12, 42));
    const elapsed = performance.now() - started;

    expect(result.order).toHaveLength(12);
    expect(elapsed).toBeLessThan(1000);
  });

  it('solves the 15-stage maximum', () => {
    const result = solve(randomDay(15, 7));
    expect(result.order).toHaveLength(15);
  });
});
