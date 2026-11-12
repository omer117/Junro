import { evaluateOrder, serviceStartFor } from './evaluate.js';
import type { SolveInput, SolveResult, Stage } from './types.js';

/**
 * Finds the order of stages that gets us to the end point as early as possible.
 * Exact: Held-Karp dynamic programming over subsets.
 *
 * State: (set of visited stages, last stage visited).
 * Value: the earliest time we can *leave* that last stage.
 * Earlier is never worse, because waiting is always allowed, so keeping only
 * the minimum per state loses nothing.
 *
 * Time O(2^n * n^2), memory O(2^n * n).
 */
export function solve(input: SolveInput): SolveResult {
  const { stages, start, end, startTime, travelTime } = input;
  const n = stages.length;
  if (n === 0) return evaluateOrder(input, []);

  const full = (1 << n) - 1;
  // best[mask * n + last] = earliest departure from `last` having visited `mask`.
  const best = new Float64Array((full + 1) * n).fill(Infinity);
  // previous[mask * n + last] = the stage visited just before `last` (-1 = came from start).
  const previous = new Int32Array((full + 1) * n).fill(-1);

  for (let j = 0; j < n; j++) {
    const stage = stages[j]!;
    const leave = leaveTime(stage, startTime + travelTime(start, stage.location, startTime));
    if (leave !== Infinity) best[(1 << j) * n + j] = leave;
  }

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const leaveLast = best[mask * n + last]!;
      if (leaveLast === Infinity) continue;

      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const target = stages[next]!;
        const leaveNext = leaveTime(
          target,
          leaveLast + travelTime(stages[last]!.location, target.location, leaveLast),
        );
        const index = (mask | (1 << next)) * n + next;
        if (leaveNext < best[index]!) {
          best[index] = leaveNext;
          previous[index] = last;
        }
      }
    }
  }

  // Close the path: pick the last stage that gets us to the end point earliest.
  let bestLast = 0;
  let bestEnd = Infinity;
  for (let last = 0; last < n; last++) {
    const leave = best[full * n + last]!;
    const arrive = leave + travelTime(stages[last]!.location, end, leave);
    if (arrive < bestEnd) {
      bestEnd = arrive;
      bestLast = last;
    }
  }

  if (bestEnd === Infinity) throw new Error('No order fits every opening window');

  // Walk the `previous` pointers backwards to rebuild the order.
  const order: string[] = [];
  let mask = full;
  let last = bestLast;
  while (last !== -1) {
    order.push(stages[last]!.id);
    const before = previous[mask * n + last]!;
    mask &= ~(1 << last);
    last = before;
  }
  order.reverse();

  return evaluateOrder(input, order);
}

/**
 * When we leave a stage if we arrive at `arrival`: wait for it to open, stay,
 * and leave. Infinity means the visit would end after the place closes, so
 * this transition is infeasible and the DP never takes it.
 */
function leaveTime(stage: Stage, arrival: number): number {
  const leave = serviceStartFor(stage, arrival) + stage.stayMinutes;
  return stage.window && leave > stage.window.close ? Infinity : leave;
}
