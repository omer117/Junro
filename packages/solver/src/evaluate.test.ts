import { describe, expect, it } from 'vitest';
import { evaluateOrder } from './evaluate.js';
import { lineTravel, loc, stageAt } from './test-utils.js';
import type { LatLng, SolveInput } from './types.js';

describe('evaluateOrder', () => {
  const input: SolveInput = {
    start: loc(0),
    end: loc(0),
    startTime: 540,
    stages: [stageAt('A', 10, 30), stageAt('B', 20, 15)],
    travelTime: lineTravel,
  };

  it('computes arrival, departure and end arrival along the order', () => {
    const result = evaluateOrder(input, ['A', 'B']);

    expect(result.order).toEqual(['A', 'B']);
    expect(result.visits).toEqual([
      { stageId: 'A', arrival: 550, serviceStart: 550, departure: 580, waited: 0 },
      { stageId: 'B', arrival: 590, serviceStart: 590, departure: 605, waited: 0 },
    ]);
    expect(result.endArrival).toBe(625);
    expect(result.violations).toEqual([]);
    expect(result.totalLateness).toBe(0);
  });

  it('with no stages goes straight from start to end', () => {
    const result = evaluateOrder({ ...input, stages: [] }, []);
    expect(result.visits).toEqual([]);
    expect(result.endArrival).toBe(540);
  });

  it('passes the real departure time of every leg to travelTime', () => {
    const calls: Array<{ from: LatLng; to: LatLng; departureTime: number }> = [];
    evaluateOrder(
      {
        ...input,
        travelTime: (from, to, departureTime) => {
          calls.push({ from, to, departureTime });
          return lineTravel(from, to, departureTime);
        },
      },
      ['A', 'B'],
    );

    expect(calls.map((c) => c.departureTime)).toEqual([540, 580, 605]);
  });
});
