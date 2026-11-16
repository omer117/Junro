import { evaluateOrder, visitAt } from './evaluate.js';
import type { SolveInput, SolveResult } from './types.js';
import { UnreachableError, validateInput } from './validate.js';

/**
 * One way of reaching a state. A state is (set of visited stages, last stage).
 * `lateness` is the minutes late so far; `leave` is when we leave the last stage.
 */
interface Label {
  lateness: number;
  leave: number;
  stage: number;
  parent: Label | null;
}

/**
 * Finds the best order of stages. Exact: Held-Karp dynamic programming over subsets.
 *
 * Best = least total lateness first (0 when everything fits; minutes past the day end time
 * count as lateness), then the most optional stops kept, then earliest arrival at the end point.
 * Must stops are always in the answer. Optional stops are left out only when keeping them costs
 * lateness, and every one that is left out is returned in `dropped`.
 *
 * Why several labels per state: when something has to be late, "less late but
 * leaving later" and "more late but leaving earlier" can both win in the end, so
 * a single number per state is not enough. We keep every label that no other label
 * beats on both counts (a Pareto set). When every stage fits there is just one.
 * Waiting is allowed, so leaving earlier is never worse, which makes this exact.
 *
 * Choosing the subset costs nothing extra: the DP already holds the best ways to visit every
 * subset, so at the end we close EVERY subset that contains all the must stops (not only the
 * full one) and take the best by the order above.
 *
 * Time O(2^n * n^2 * labels), memory O(2^n * n * labels).
 */
export function solve(input: SolveInput): SolveResult {
  const { start, end, startTime, travelTime, endTime } = input;
  validateInput(input);

  // An optional stop that is closed on the whole day cannot be visited: it is dropped up front.
  const stages = input.stages.filter(
    (stage) => !(stage.priority === 'optional' && stage.closedAllDay),
  );
  const n = stages.length;
  if (n === 0) return withDropped(input, evaluateOrder(input, []), []);

  // Bit i is set for the must stops. A subset is allowed only if it contains all of them.
  let mustMask = 0;
  stages.forEach((stage, i) => {
    if (stage.priority !== 'optional') mustMask |= 1 << i;
  });

  const full = (1 << n) - 1;
  const states: Label[][] = Array.from({ length: (full + 1) * n }, () => []);

  /** Visit `stages[next]` after arriving at `arrival`, coming from `parent`. */
  const visit = (parent: Label | null, mask: number, next: number, arrival: number) => {
    // Infinity / NaN means no route: this leg does not exist.
    if (!Number.isFinite(arrival)) return;
    const target = stages[next]!;
    const timing = visitAt(target, arrival);
    const leave = timing.departure;
    const lateness = (parent?.lateness ?? 0) + timing.lateness;
    addLabel(states[(mask | (1 << next)) * n + next]!, { lateness, leave, stage: next, parent });
  };

  for (let j = 0; j < n; j++) {
    visit(null, 0, j, startTime + travelTime(start, stages[j]!.location, startTime));
  }

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      for (const label of states[mask * n + last]!) {
        for (let next = 0; next < n; next++) {
          if (mask & (1 << next)) continue;
          const there = stages[next]!.location;
          visit(
            label,
            mask,
            next,
            label.leave + travelTime(stages[last]!.location, there, label.leave),
          );
        }
      }
    }
  }

  // Close the path to the end point for every allowed subset and pick the best
  // (total lateness including overtime, then most optional stops kept, then earliest arrival).
  // Labels that were dropped inside the DP can never win here: both lateness and the arrival at
  // the end only grow with `leave`, and overtime grows with the arrival.
  const mustCount = popcount(mustMask);
  let best: { label: Label | null; total: number; kept: number; arrive: number } | null = null;
  const consider = (label: Label | null, mask: number, arrive: number) => {
    if (!Number.isFinite(arrive)) return;
    const total =
      (label?.lateness ?? 0) + (endTime === undefined ? 0 : Math.max(0, arrive - endTime));
    const kept = popcount(mask) - mustCount;
    if (
      !best ||
      total < best.total ||
      (total === best.total && (kept > best.kept || (kept === best.kept && arrive < best.arrive)))
    ) {
      best = { label, total, kept, arrive };
    }
  };

  // No stop at all (possible only when there is no must stop): straight to the end point.
  if (mustMask === 0) consider(null, 0, startTime + travelTime(start, end, startTime));
  for (let mask = 1; mask <= full; mask++) {
    if ((mask & mustMask) !== mustMask) continue;
    for (let last = 0; last < n; last++) {
      for (const label of states[mask * n + last]!) {
        consider(label, mask, label.leave + travelTime(stages[last]!.location, end, label.leave));
      }
    }
  }

  const winner = best as { label: Label | null } | null;
  if (!winner) throw new UnreachableError();

  // Follow the parent links backwards to rebuild the order.
  const order: string[] = [];
  for (let label: Label | null = winner.label; label; label = label.parent)
    order.push(stages[label.stage]!.id);
  order.reverse();

  return withDropped(input, evaluateOrder(input, order), order);
}

/** Every stop that is not in the order was dropped (only optional ones can be), in input order. */
function withDropped(input: SolveInput, result: SolveResult, order: string[]): SolveResult {
  const visited = new Set(order);
  return { ...result, dropped: input.stages.filter((s) => !visited.has(s.id)).map((s) => s.id) };
}

function popcount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest; rest &= rest - 1) count++;
  return count;
}

/** Adds `label` unless an existing one is at least as good on both counts; drops labels it beats. */
function addLabel(labels: Label[], label: Label): void {
  for (const other of labels) {
    if (other.lateness <= label.lateness && other.leave <= label.leave) return;
  }
  let kept = 0;
  for (const other of labels) {
    if (!(label.lateness <= other.lateness && label.leave <= other.leave)) labels[kept++] = other;
  }
  labels.length = kept;
  labels.push(label);
}
