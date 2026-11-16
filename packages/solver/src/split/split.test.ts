import { describe, expect, it } from 'vitest';
import { solve } from '../solve.js';
import { lineTravel, loc, seededRandom } from '../test-utils.js';
import type { SolveResult, Stage } from '../types.js';
import { pinWindow } from './pin.js';
import { DEFAULT_SPLIT_BUDGET, splitSegment } from './split.js';
import type { SplitDay, SplitInput, SplitPlace } from './types.js';

const day = (id: string, extra: Partial<SplitDay> = {}): SplitDay => ({
  id,
  start: loc(0),
  end: loc(0),
  startTime: 540,
  ...extra,
});

const place = (id: string, x: number, extra: Partial<SplitPlace> = {}, days = 2): SplitPlace => ({
  id,
  location: loc(x),
  stayMinutes: 30,
  priority: 'must',
  hours: Array.from({ length: days }, () => ({})),
  ...extra,
});

const input = (
  days: SplitDay[],
  places: SplitPlace[],
  extra: Partial<SplitInput> = {},
): SplitInput => ({
  days,
  places,
  travelTime: lineTravel,
  ...extra,
});

const idsOf = (result: ReturnType<typeof splitSegment>, dayIndex: number) =>
  [...result.days[dayIndex]!.result.order].sort();

describe('splitSegment: which place goes on which day', () => {
  it('puts nearby places together: two clusters, two days, one cluster each', () => {
    const places = [10, 11, 12]
      .map((x) => place(`L${x}`, x))
      .concat([88, 89, 90].map((x) => place(`R${x}`, x)));
    const result = splitSegment(
      input(
        [day('d1', { start: loc(50), end: loc(50) }), day('d2', { start: loc(50), end: loc(50) })],
        places,
      ),
    );

    const first = idsOf(result, 0);
    const second = idsOf(result, 1);
    const sides = [first, second].map((ids) => new Set(ids.map((id) => id[0])));
    expect(sides.every((s) => s.size === 1)).toBe(true);
    expect(new Set([...sides[0]!, ...sides[1]!]).size).toBe(2);
    expect(result.leftOut).toEqual([]);
  });

  it('balances the load: six equal places over three days is two each', () => {
    const places = [10, 12, 14, 16, 18, 20].map((x) => place(`p${x}`, x, {}, 3));
    const result = splitSegment(input([day('a'), day('b'), day('c')], places));

    expect(result.days.map((d) => d.result.order.length)).toEqual([2, 2, 2]);
  });

  it('never puts a place on a day it is closed all day', () => {
    const places = [
      place('museum', 10, { hours: [{ closedAllDay: true }, {}] }),
      place('park', 12),
    ];
    const result = splitSegment(input([day('mon'), day('tue')], places));

    expect(result.days[0]!.result.order).not.toContain('museum');
    expect(result.days[1]!.result.order).toContain('museum');
  });

  it('leaves out a place that is closed on every day, with the reason (a must too)', () => {
    const places = [
      place('shut', 10, { hours: [{ closedAllDay: true }, { closedAllDay: true }] }),
      place('open', 12),
    ];
    const result = splitSegment(input([day('a'), day('b')], places));

    expect(result.leftOut).toEqual([{ id: 'shut', reason: 'closed_all_days' }]);
    expect(result.days.flatMap((d) => d.result.order)).toEqual(['open']);
  });

  it('keeps a booked place on its day, at the booked time, and arranges the others around it', () => {
    const places = [
      place('dinner', 10, { pin: { day: 1, time: 1140 } }),
      place('a', 11),
      place('b', 12),
      place('c', 13),
    ];
    const result = splitSegment(input([day('d1'), day('d2')], places));

    const dinner = result.days[1]!.result.visits.find((v) => v.stageId === 'dinner')!;
    expect(dinner.serviceStart).toBe(1140);
    expect(result.days[0]!.result.order).not.toContain('dinner');
    expect(result.leftOut).toEqual([]);
  });

  it('moves an optional place to another day instead of dropping it', () => {
    // Day one ends at 11:40 and is mostly taken by a booking; the optional place fits on day two.
    const places = [
      place('booked', 10, { stayMinutes: 100, pin: { day: 0, time: 560 } }),
      place('extra', 10, { stayMinutes: 60, priority: 'optional' }),
    ];
    const result = splitSegment(input([day('d1', { endTime: 700 }), day('d2')], places));

    expect(result.days[0]!.result.order).toEqual(['booked']);
    expect(result.days[1]!.result.order).toEqual(['extra']);
    expect(result.score.droppedOptional).toBe(0);
    expect(result.leftOut).toEqual([]);
  });

  it('reports a place that does not fit anywhere as left out, never silently', () => {
    const places = [
      place('must', 5, { stayMinutes: 100 }, 1),
      place('extra', 6, { stayMinutes: 100, priority: 'optional' }, 1),
    ];
    const result = splitSegment(input([day('d1', { endTime: 700 })], places, {}));

    expect(result.leftOut).toEqual([{ id: 'extra', reason: 'did_not_fit' }]);
    expect(result.days[0]!.result.order).toEqual(['must']);
  });

  it('gives the same answer every time', () => {
    const random = seededRandom(7);
    const places = Array.from({ length: 9 }, (_, i) =>
      place(`p${i}`, Math.floor(random() * 80), {}, 3),
    );
    const run = () => splitSegment(input([day('a'), day('b'), day('c')], places));

    expect(run()).toEqual(run());
  });

  it('returns a valid plan when the budget runs out, and says so', () => {
    const random = seededRandom(3);
    const places = Array.from({ length: 12 }, (_, i) =>
      place(`p${i}`, Math.floor(random() * 90), {}, 4),
    );
    const result = splitSegment(
      input([day('a'), day('b'), day('c'), day('d')], places, { budget: 1 }),
    );

    expect(result.exhausted).toBe(true);
    const all = result.days.flatMap((d) => d.result.order);
    expect([...all, ...result.leftOut.map((l) => l.id)].sort()).toEqual(
      places.map((p) => p.id).sort(),
    );
  });

  it('is stable on a re-run: adding one place moves at most a few others', () => {
    const random = seededRandom(11);
    const places = Array.from({ length: 8 }, (_, i) =>
      place(`p${i}`, Math.floor(random() * 80), {}, 3),
    );
    const days = [day('a'), day('b'), day('c')];
    const before = splitSegment(input(days, places));
    const current: Record<string, number> = {};
    before.days.forEach((d, index) => d.result.order.forEach((id) => (current[id] = index)));

    const after = splitSegment(input(days, [...places, place('new', 40, {}, 3)], { current }));

    const moved = places.filter((p) => {
      const was = current[p.id];
      return !after.days[was!]!.result.order.includes(p.id);
    });
    expect(moved.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Exactness: the same objective, computed independently over EVERY assignment of places to days.

function scoreOf(results: SolveResult[], startTimes: number[]) {
  const D = results.length;
  const loads = results.map((r, i) => r.endArrival - startTimes[i]!);
  const total = loads.reduce((a, b) => a + b, 0);
  const travel = results.reduce(
    (sum, r, i) =>
      sum +
      (r.endArrival - startTimes[i]! - r.visits.reduce((s, v) => s + (v.departure - v.arrival), 0)),
    0,
  );
  const imbalance = loads.reduce((sum, load) => sum + Math.abs(load * D - total), 0);
  return [
    results.reduce((s, r) => s + r.totalLateness, 0),
    results.reduce((s, r) => s + r.dropped.length, 0),
    2 * travel * D + imbalance,
  ];
}

function bruteForceBest(problem: SplitInput): number[] {
  const { days, places } = problem;
  const cache = new Map<string, SolveResult>();
  const solveDay = (d: number, ids: number[]) => {
    const key = `${d}|${ids.join(',')}`;
    let result = cache.get(key);
    if (!result) {
      const stages: Stage[] = ids.map((i) => {
        const p = places[i]!;
        return {
          id: p.id,
          location: p.location,
          stayMinutes: p.stayMinutes,
          priority: p.pin ? 'must' : p.priority,
          ...(p.pin && p.pin.day === d
            ? { windows: [pinWindow(p.pin.time, p.stayMinutes)] }
            : p.hours[d]),
        };
      });
      const dayInput = days[d]!;
      result = solve({
        start: dayInput.start,
        end: dayInput.end,
        startTime: dayInput.startTime,
        endTime: dayInput.endTime ?? 1320,
        stages,
        travelTime: problem.travelTime,
      });
      cache.set(key, result);
    }
    return result;
  };

  let best: number[] | null = null;
  const assign: number[] = [];
  const walk = (i: number) => {
    if (i === places.length) {
      const buckets = days.map((_, d) => assign.flatMap((a, idx) => (a === d ? [idx] : [])));
      const value = scoreOf(
        buckets.map((ids, d) => solveDay(d, ids)),
        days.map((d) => d.startTime),
      );
      if (!best || compare(value, best) < 0) best = value;
      return;
    }
    const p = places[i]!;
    for (let d = 0; d < days.length; d++) {
      if (p.pin && p.pin.day !== d) continue;
      assign[i] = d;
      walk(i + 1);
    }
  };
  walk(0);
  return best!;
}

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

function resultScore(problem: SplitInput, result: ReturnType<typeof splitSegment>) {
  return scoreOf(
    result.days.map((d) => d.result),
    problem.days.map((d) => d.startTime),
  );
}

function randomProblem(seed: number, placeCount: number, dayCount: number): SplitInput {
  const random = seededRandom(seed);
  const days = Array.from({ length: dayCount }, (_, i) =>
    day(`d${i}`, {
      start: loc(Math.floor(random() * 40)),
      end: loc(Math.floor(random() * 40)),
      ...(random() < 0.5 ? { endTime: 540 + 150 + Math.floor(random() * 200) } : {}),
    }),
  );
  const places = Array.from({ length: placeCount }, (_, i) => {
    const open = 540 + Math.floor(random() * 150);
    return place(
      `p${i}`,
      Math.floor(random() * 90),
      {
        stayMinutes: 15 + Math.floor(random() * 50),
        priority: random() < 0.4 ? 'optional' : 'must',
        hours: Array.from({ length: dayCount }, () =>
          random() < 0.2
            ? { windows: [{ open, close: open + 60 + Math.floor(random() * 200) }] }
            : {},
        ),
      },
      dayCount,
    );
  });
  return input(days, places);
}

describe('splitSegment is optimal on small inputs (exhaustive mode)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('matches brute force (seed %i)', (seed) => {
    const problem = randomProblem(seed, 3 + (seed % 3), 2 + (seed % 2));

    expect(resultScore(problem, splitSegment(problem))).toEqual(bruteForceBest(problem));
  });
});

describe('splitSegment on inputs above the exhaustive limit (heuristic)', () => {
  it('is never worse on lateness or drops, and within 10% of the best on travel + balance', () => {
    const seeds = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    let exact = 0;
    for (const seed of seeds) {
      const problem = randomProblem(seed, 8, 4); // 4^8 = 65 536 assignments: above the 20 000 limit
      const found = resultScore(problem, splitSegment(problem));
      const best = bruteForceBest(problem);

      expect(found.slice(0, 2)).toEqual(best.slice(0, 2));
      expect(best[2]! / found[2]!).toBeGreaterThanOrEqual(0.9);
      if (compare(found, best) === 0) exact++;
    }
    // Most seeds are solved exactly (8 of 10 when this was written).
    expect(exact).toBeGreaterThanOrEqual(7);
  });
});

describe('splitSegment on the largest input allowed', () => {
  it('finishes within the work-unit budget (the budget is units of work, not time)', () => {
    const problem = randomProblem(99, 60, 10);
    const result = splitSegment(problem);

    const all = result.days.flatMap((d) => d.result.order);
    expect(all.length + result.leftOut.length).toBe(60);
    // A solve is only started while the budget lasts, so the overshoot is at most the last
    // solves of the days themselves.
    expect(result.workUnits).toBeLessThanOrEqual(DEFAULT_SPLIT_BUDGET + 3_000_000);
  });
});
