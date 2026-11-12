import { describe, expect, it } from 'vitest';
import { insertStage } from './insert.js';
import { solve } from './solve.js';
import { lineTravel, loc, stageAt } from './test-utils.js';
import { InvalidInputError, UnreachableError } from './validate.js';
import type { SolveInput } from './types.js';

const base = (stages: SolveInput['stages'], overrides: Partial<SolveInput> = {}): SolveInput => ({
  start: loc(0),
  end: loc(0),
  startTime: 100,
  stages,
  travelTime: lineTravel,
  ...overrides,
});

describe('edge cases', () => {
  it('0 stages: straight from start to end', () => {
    const result = solve(base([], { end: loc(40) }));
    expect(result.order).toEqual([]);
    expect(result.endArrival).toBe(140);
  });

  it('1 stage', () => {
    const result = solve(base([stageAt('A', 10, 30)]));
    expect(result.order).toEqual(['A']);
    expect(result.endArrival).toBe(150);
  });

  it('start equals end', () => {
    const result = solve(base([stageAt('A', 10, 5), stageAt('B', 20, 5)]));
    expect(result.endArrival).toBe(150);
  });

  it('identical locations: all orders tie, the answer is complete and repeatable', () => {
    const stages = ['p', 'q', 'r', 's'].map((id) => stageAt(id, 10, 5));
    const first = solve(base(stages));
    expect([...first.order].sort()).toEqual(['p', 'q', 'r', 's']);
    expect(first.endArrival).toBe(100 + 10 + 20 + 10);
    expect(solve(base(stages)).order).toEqual(first.order);
  });

  it('a stage longer than its window is flagged, not dropped', () => {
    const result = solve(base([stageAt('T', 10, 90, { open: 0, close: 60 })]));
    expect(result.order).toEqual(['T']);
    expect(result.violations).toEqual([{ stageId: 'T', kind: 'window_too_short' }]);
  });
});

describe('input validation', () => {
  it('refuses more than 15 stages with a clear message', () => {
    const stages = Array.from({ length: 16 }, (_, i) => stageAt(`s${i}`, i, 1));
    expect(() => solve(base(stages))).toThrow(RangeError);
    expect(() => solve(base(stages))).toThrow(/15/);
  });

  it.each([
    ['duplicate ids', [stageAt('A', 1, 5), stageAt('A', 2, 5)]],
    ['negative stay', [stageAt('A', 1, -1)]],
    ['NaN stay', [stageAt('A', 1, NaN)]],
    ['window that closes when it opens', [stageAt('A', 1, 5, { open: 600, close: 600 })]],
  ])('rejects %s', (_name, stages) => {
    expect(() => solve(base(stages))).toThrow(InvalidInputError);
  });

  it('also validates on insert', () => {
    expect(() => insertStage(base([stageAt('A', 1, 5)]), ['A'], stageAt('A', 2, 5))).toThrow(
      InvalidInputError,
    );
  });
});

describe('unreachable legs (travel time is Infinity or NaN)', () => {
  const blocked =
    (blockedId: number): SolveInput['travelTime'] =>
    (from, to) =>
      from.lng === blockedId || to.lng === blockedId ? Infinity : Math.abs(from.lng - to.lng);

  it('throws when two stages cannot reach each other in either direction', () => {
    const travelTime: SolveInput['travelTime'] = (from, to) =>
      (from.lng === 10 && to.lng === 20) || (from.lng === 20 && to.lng === 10)
        ? Infinity
        : Math.abs(from.lng - to.lng);
    const stages = [stageAt('A', 10, 5), stageAt('B', 20, 5)];
    expect(() => solve(base(stages, { travelTime }))).toThrow(UnreachableError);
  });

  it('chooses the order that avoids a one-way blocked leg', () => {
    const travelTime: SolveInput['travelTime'] = (from, to) =>
      from.lng === 10 && to.lng === 20 ? Infinity : Math.abs(from.lng - to.lng);
    const result = solve(base([stageAt('A', 10, 5), stageAt('B', 20, 5)], { travelTime }));
    expect(result.order).toEqual(['B', 'A']);
  });

  it('throws UnreachableError when a stage cannot be reached at all', () => {
    const stages = [stageAt('A', 10, 5)];
    expect(() => solve(base(stages, { travelTime: blocked(10) }))).toThrow(UnreachableError);
  });

  it('treats NaN as unreachable', () => {
    const travelTime: SolveInput['travelTime'] = () => NaN;
    expect(() => solve(base([stageAt('A', 10, 5)], { travelTime }))).toThrow(UnreachableError);
  });
});
