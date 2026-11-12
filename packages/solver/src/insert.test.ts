import { describe, expect, it } from 'vitest';
import { insertStage, removeStage } from './insert.js';
import { solve } from './solve.js';
import { lineTravel, loc, stageAt } from './test-utils.js';
import { InvalidInputError } from './validate.js';
import type { SolveInput } from './types.js';

const base = (stages: SolveInput['stages']): SolveInput => ({
  start: loc(0),
  end: loc(0),
  startTime: 0,
  stages,
  travelTime: lineTravel,
});

describe('insertStage (minimal change)', () => {
  const a = stageAt('a', 10, 10);
  const c = stageAt('c', 30, 10);

  it('puts the new stage in between when it lies on the way', () => {
    const result = insertStage(base([a, c]), ['a', 'c'], stageAt('b', 20, 10));

    expect(result.order).toEqual(['a', 'b', 'c']);
    // Was 80 (60 travel + 2 stays); now only the extra stay is added.
    expect(result.endArrival).toBe(90);
  });

  it('puts a stage that is before everything first', () => {
    const result = insertStage(base([a, c]), ['a', 'c'], stageAt('z', 5, 10));

    expect(result.order).toEqual(['z', 'a', 'c']);
    expect(result.endArrival).toBe(90);
  });

  it('keeps the existing order even when a full recalculation would change it', () => {
    // Heading to an end point far away: the order c, a is clearly bad.
    const far = (stages: SolveInput['stages']): SolveInput => ({ ...base(stages), end: loc(100) });
    const first = stageAt('a', 10, 10);
    const last = stageAt('c', 90, 10);
    const middle = stageAt('b', 50, 10);

    const minimal = insertStage(far([first, last]), ['c', 'a'], middle);
    const full = solve(far([first, middle, last]));

    expect(minimal.order.filter((id) => id !== 'b')).toEqual(['c', 'a']);
    expect(full.order).toEqual(['a', 'b', 'c']);
    expect(full.endArrival).toBeLessThan(minimal.endArrival);
  });

  it('inserts into an empty day', () => {
    const result = insertStage(base([]), [], a);

    expect(result.order).toEqual(['a']);
    expect(result.endArrival).toBe(30);
  });
});

describe('removeStage', () => {
  it('skips the stage and keeps the rest in order', () => {
    const stages = [stageAt('a', 10, 10), stageAt('b', 20, 10), stageAt('c', 30, 10)];
    const before = solve(base(stages));
    const result = removeStage(base(stages), ['a', 'b', 'c'], 'b');

    expect(result.order).toEqual(['a', 'c']);
    expect(result.endArrival).toBeLessThanOrEqual(before.endArrival);
  });

  it('rejects an id that is not in the order', () => {
    expect(() => removeStage(base([stageAt('a', 10, 10)]), ['a'], 'nope')).toThrow(
      InvalidInputError,
    );
  });
});
