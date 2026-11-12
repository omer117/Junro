import { describe, expect, it } from 'vitest';
import { solve } from './solve.js';
import { lineTravel, loc, stageAt } from './test-utils.js';
import type { SolveInput, Stage } from './types.js';

const base = (stages: Stage[]): SolveInput => ({
  start: loc(0),
  end: loc(0),
  startTime: 540,
  stages,
  travelTime: lineTravel,
});

const closed = (id: string, x: number, stay: number): Stage => ({
  ...stageAt(id, x, stay),
  closedAllDay: true,
});

describe('a stage that is closed all day', () => {
  it('is kept in the order and flagged, not dropped', () => {
    const result = solve(base([stageAt('a', 10, 10), closed('shut', 20, 10)]));

    expect(result.order).toHaveLength(2);
    expect(result.violations).toEqual([{ stageId: 'shut', kind: 'closed_all_day' }]);
  });

  it('does not count as lateness, so it never bends the order of the other stages', () => {
    const withClosed = solve(
      base([stageAt('a', 10, 10), closed('shut', 20, 10), stageAt('c', 30, 10)]),
    );
    const withOpen = solve(
      base([stageAt('a', 10, 10), stageAt('shut', 20, 10), stageAt('c', 30, 10)]),
    );

    expect(withClosed.totalLateness).toBe(0);
    expect(withClosed.order).toEqual(withOpen.order);
    expect(withClosed.endArrival).toBe(withOpen.endArrival);
  });

  it('ignores a window that comes with it', () => {
    const stage: Stage = { ...closed('shut', 20, 10), window: { open: 0, close: 2000 } };

    expect(solve(base([stage])).violations).toEqual([{ stageId: 'shut', kind: 'closed_all_day' }]);
  });
});
