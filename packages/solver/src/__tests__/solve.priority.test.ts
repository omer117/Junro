import { describe, expect, it } from 'vitest';
import { evaluateOrder } from '../evaluate.js';
import { solve } from '../solve.js';
import { lineTravel, loc, permutations, seededRandom, stageAt } from './test-utils.js';
import type { SolveInput, Stage } from '../types.js';
import { UnreachableError } from '../validate.js';

const must = (id: string, x: number, stay: number, window?: { open: number; close: number }) =>
  ({ ...stageAt(id, x, stay, window), priority: 'must' }) satisfies Stage;
const optional = (id: string, x: number, stay: number, window?: { open: number; close: number }) =>
  ({ ...stageAt(id, x, stay, window), priority: 'optional' }) satisfies Stage;

const input = (stages: Stage[], extra: Partial<SolveInput> = {}): SolveInput => ({
  start: loc(0),
  end: loc(0),
  startTime: 540,
  stages,
  travelTime: lineTravel,
  ...extra,
});

describe('solve with priorities and a day end time: edge cases', () => {
  it('keeps every stop when everything fits (nothing is dropped for no reason)', () => {
    const result = solve(input([must('a', 10, 20), optional('b', 20, 20), optional('c', 30, 20)]));

    expect(result.order).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  it('drops an optional stop that would make the day end after the day end time', () => {
    // Day 9:00 to 12:00 at most. a is a must (10 away, 20 stay): back by 9:40. b is 60 away and
    // takes 60: keeping it means back by 12:40, which is after 12:00.
    const result = solve(input([must('a', 10, 20), optional('b', 60, 60)], { endTime: 720 }));

    expect(result.order).toEqual(['a']);
    expect(result.dropped).toEqual(['b']);
    expect(result.totalLateness).toBe(0);
  });

  it('never drops a must, even when the musts alone end after the day end time (it is flagged)', () => {
    const result = solve(input([must('a', 100, 30), optional('b', 10, 10)], { endTime: 600 }));

    expect(result.order).toEqual(['a']);
    expect(result.dropped).toEqual(['b']);
    expect(result.violations).toContainEqual({ kind: 'past_day_end', minutesLate: 170 });
    expect(result.totalLateness).toBe(170);
  });

  it('drops an optional stop that is closed on the whole day, but keeps a must that is', () => {
    const closedOptional = { ...optional('o', 10, 10), closedAllDay: true };
    const closedMust = { ...must('m', 20, 10), closedAllDay: true };

    const result = solve(input([closedOptional, closedMust, must('a', 30, 10)]));

    expect(result.dropped).toEqual(['o']);
    expect([...result.order].sort()).toEqual(['a', 'm']);
    expect(result.violations).toContainEqual({ stageId: 'm', kind: 'closed_all_day' });
  });

  it('drops an optional stop that would be reached too late, to keep the rest on time', () => {
    // b closes at 9:30 and is 30 away: reachable only if visited first. Going there first makes a
    // (a must closing at 9:50) late, so b is dropped.
    const result = solve(
      input([
        must('a', 20, 10, { open: 0, close: 590 }),
        optional('b', 40, 10, { open: 0, close: 570 }),
      ]),
    );

    expect(result.dropped).toEqual(['b']);
    expect(result.totalLateness).toBe(0);
  });

  it('with only optional stops and no room for any, goes straight to the end point', () => {
    const result = solve(input([optional('a', 100, 50)], { endTime: 560 }));

    expect(result.order).toEqual([]);
    expect(result.dropped).toEqual(['a']);
    expect(result.endArrival).toBe(540);
  });

  it('keeps as many optional stops as it can, then the earlier arrival', () => {
    // Three optional stops of 30 minutes each, 15 minutes from the hotel in a row: with a day end
    // time of 10:50 (110 minutes after 9:00) two fit.
    const result = solve(
      input([optional('a', 5, 30), optional('b', 10, 30), optional('c', 15, 30)], {
        endTime: 650,
      }),
    );

    expect(result.order).toHaveLength(2);
    expect(result.dropped).toHaveLength(1);
    expect(result.totalLateness).toBe(0);
  });

  it('an optional stop that cannot be reached is dropped; a must that cannot be reached throws', () => {
    const noRoadTo = (target: number) => (from: { lng: number }, to: { lng: number }) =>
      from.lng === target || to.lng === target ? Infinity : Math.abs(from.lng - to.lng);

    const dropped = solve(
      input([must('a', 10, 10), optional('far', 99, 10)], {
        travelTime: noRoadTo(99) as SolveInput['travelTime'],
      }),
    );
    expect(dropped.order).toEqual(['a']);
    expect(dropped.dropped).toEqual(['far']);

    expect(() =>
      solve(input([must('far', 99, 10)], { travelTime: noRoadTo(99) as SolveInput['travelTime'] })),
    ).toThrow(UnreachableError);
  });

  it('without priorities or an end time it answers exactly as before', () => {
    const plain = input([stageAt('a', 30, 10), stageAt('b', 10, 10), stageAt('c', 20, 10)]);
    const marked = input([must('a', 30, 10), must('b', 10, 10), must('c', 20, 10)]);

    const result = solve(plain);

    expect(result.dropped).toEqual([]);
    expect(solve(marked)).toEqual(result);
  });
});

describe('evaluateOrder with a day end time', () => {
  it('counts the minutes past the day end time in the total, and says so', () => {
    const result = evaluateOrder(input([must('a', 10, 20)], { endTime: 560 }), ['a']);

    // Back at 9:40 (580) against an end time of 9:20 (560).
    expect(result.endArrival).toBe(580);
    expect(result.totalLateness).toBe(20);
    expect(result.violations).toContainEqual({ kind: 'past_day_end', minutesLate: 20 });
  });

  it('adds nothing when the end time is met or not given', () => {
    const stages = [must('a', 10, 20)];

    expect(evaluateOrder(input(stages, { endTime: 580 }), ['a']).totalLateness).toBe(0);
    expect(evaluateOrder(input(stages), ['a']).violations).toEqual([]);
  });
});

/** Everything the solver is judged on, in the order it is judged. */
function objective(candidate: ReturnType<typeof solve>, mustCount: number) {
  return [candidate.totalLateness, -(candidate.order.length - mustCount), candidate.endArrival];
}

function bestByBruteForce(problem: SolveInput) {
  const usable = problem.stages.filter(
    (s) => !(s.priority === 'optional' && s.closedAllDay === true),
  );
  const musts = usable.filter((s) => s.priority !== 'optional');
  const optionals = usable.filter((s) => s.priority === 'optional');
  let best: number[] | null = null;

  for (let bits = 0; bits < 1 << optionals.length; bits++) {
    const kept = [...musts, ...optionals.filter((_, i) => bits & (1 << i))];
    for (const order of permutations(kept.map((s) => s.id))) {
      const result = evaluateOrder({ ...problem, stages: kept }, order);
      const value = objective(result, musts.length);
      if (!best || compare(value, best) < 0) best = value;
    }
  }
  return best!;
}

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

describe('solve is exact: brute force over every subset of the optional stops and every order', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('matches the best possible answer (seed %i)', (seed) => {
    const random = seededRandom(seed);
    const count = 2 + Math.floor(random() * 5); // 2 to 6 stops
    const stages: Stage[] = Array.from({ length: count }, (_, i) => {
      const x = Math.floor(random() * 60);
      const stay = 5 + Math.floor(random() * 25);
      const open = Math.floor(random() * 200);
      const window =
        random() < 0.5
          ? { open: 540 + open, close: 540 + open + 30 + Math.floor(random() * 200) }
          : undefined;
      return {
        ...(window ? stageAt(`s${i}`, x, stay, window) : stageAt(`s${i}`, x, stay)),
        priority: random() < 0.55 ? 'optional' : 'must',
        ...(random() < 0.08 ? { closedAllDay: true } : {}),
      } as Stage;
    });
    const problem = input(stages, {
      ...(random() < 0.7 ? { endTime: 540 + 100 + Math.floor(random() * 300) } : {}),
    });
    const mustCount = stages.filter((s) => s.priority !== 'optional').length;

    const result = solve(problem);

    expect(objective(result, mustCount)).toEqual(bestByBruteForce(problem));
    // Every optional stop that is not visited is reported, every must is visited.
    const visited = new Set(result.order);
    for (const stage of stages) {
      if (stage.priority !== 'optional') expect(visited.has(stage.id)).toBe(true);
      else expect(visited.has(stage.id) || result.dropped.includes(stage.id)).toBe(true);
    }
    expect(result.dropped.every((id) => !visited.has(id))).toBe(true);
  });
});
