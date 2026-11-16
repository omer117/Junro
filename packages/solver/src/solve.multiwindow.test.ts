import { describe, expect, it } from 'vitest';
import { evaluateOrder } from './evaluate.js';
import { solve } from './solve.js';
import { lineTravel, loc, permutations, seededRandom } from './test-utils.js';
import type { SolveInput, Stage, TimeWindow } from './types.js';

function randomWindows(random: () => number): TimeWindow[] | undefined {
  const roll = random();
  if (roll < 0.25) return undefined;
  const count = roll < 0.6 ? 1 : roll < 0.85 ? 2 : 3;
  const windows: TimeWindow[] = [];
  let cursor = 540 + Math.floor(random() * 120);
  for (let i = 0; i < count; i++) {
    const open = cursor;
    const close = open + 20 + Math.floor(random() * 150);
    windows.push({ open, close });
    cursor = close + 10 + Math.floor(random() * 90);
  }
  return windows;
}

const objective = (r: ReturnType<typeof solve>, mustCount: number) => [
  r.totalLateness,
  -(r.order.length - mustCount),
  r.endArrival,
];
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

describe('solve is exact with several opening windows per stop', () => {
  it.each(Array.from({ length: 24 }, (_, i) => i + 1))('seed %i (with priorities)', (seed) => {
    const random = seededRandom(seed);
    const count = 2 + Math.floor(random() * 5);
    const stages: Stage[] = Array.from({ length: count }, (_, i) => {
      const windows = randomWindows(random);
      return {
        id: `s${i}`,
        location: loc(Math.floor(random() * 60)),
        stayMinutes: 5 + Math.floor(random() * 40),
        ...(windows ? { windows } : {}),
        priority: seed % 2 === 0 && random() < 0.5 ? 'optional' : 'must',
      };
    });
    const problem: SolveInput = {
      start: loc(Math.floor(random() * 60)),
      end: loc(Math.floor(random() * 60)),
      startTime: 540,
      stages,
      travelTime: lineTravel,
      ...(random() < 0.5 ? { endTime: 540 + 200 + Math.floor(random() * 400) } : {}),
    };

    const musts = stages.filter((s) => s.priority !== 'optional');
    const optionals = stages.filter((s) => s.priority === 'optional');
    let best: number[] | null = null;
    for (let bits = 0; bits < 1 << optionals.length; bits++) {
      const kept = [...musts, ...optionals.filter((_, i) => bits & (1 << i))];
      for (const order of permutations(kept.map((s) => s.id))) {
        const value = objective(evaluateOrder({ ...problem, stages: kept }, order), musts.length);
        if (!best || compare(value, best) < 0) best = value;
      }
    }

    expect(objective(solve(problem), musts.length)).toEqual(best);
  });
});

describe('violations with several windows', () => {
  const base = (windows: TimeWindow[], stay: number): SolveInput => ({
    start: loc(0),
    end: loc(0),
    startTime: 540,
    stages: [{ id: 'a', location: loc(1), stayMinutes: stay, windows }],
    travelTime: lineTravel,
  });

  it('a 4 h stay is fine when one of two windows is long enough', () => {
    const r = solve(
      base(
        [
          { open: 540, close: 720 },
          { open: 780, close: 1080 },
        ],
        240,
      ),
    );
    expect(r.violations).toEqual([]);
    expect(r.visits[0]!.window).toEqual({ open: 780, close: 1080 });
  });

  it('window_too_short only when the stay is longer than every window', () => {
    const r = solve(
      base(
        [
          { open: 540, close: 720 },
          { open: 780, close: 900 },
        ],
        240,
      ),
    );
    expect(r.violations).toEqual([{ stageId: 'a', kind: 'window_too_short' }]);
  });

  it('closed (fixable by order) when late in a window that is long enough', () => {
    const r = solve({ ...base([{ open: 540, close: 1000 }], 100), startTime: 950 });
    expect(r.violations[0]).toMatchObject({ kind: 'closed' });
  });
});
