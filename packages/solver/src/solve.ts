import { evaluateOrder, latenessOf, serviceStartFor } from './evaluate.js';
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
 * Best = least total lateness first (0 when everything fits), then earliest arrival
 * at the end point.
 *
 * Why several labels per state: when something has to be late, "less late but
 * leaving later" and "more late but leaving earlier" can both win in the end, so
 * a single number per state is not enough. We keep every label that no other label
 * beats on both counts (a Pareto set). When every stage fits there is just one.
 * Waiting is allowed, so leaving earlier is never worse, which makes this exact.
 *
 * Time O(2^n * n^2 * labels), memory O(2^n * n * labels).
 */
export function solve(input: SolveInput): SolveResult {
  const { stages, start, end, startTime, travelTime } = input;
  validateInput(input);
  const n = stages.length;
  if (n === 0) return evaluateOrder(input, []);

  const full = (1 << n) - 1;
  const states: Label[][] = Array.from({ length: (full + 1) * n }, () => []);

  /** Visit `stages[next]` after arriving at `arrival`, coming from `parent`. */
  const visit = (parent: Label | null, mask: number, next: number, arrival: number) => {
    // Infinity / NaN means no route: this leg does not exist.
    if (!Number.isFinite(arrival)) return;
    const target = stages[next]!;
    const leave = serviceStartFor(target, arrival) + target.stayMinutes;
    const lateness = (parent?.lateness ?? 0) + latenessOf(target, leave);
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

  // Close the path to the end point and pick the best (lateness, arrival).
  let winner: Label | null = null;
  let winnerEnd = Infinity;
  for (let last = 0; last < n; last++) {
    for (const label of states[full * n + last]!) {
      const arrive = label.leave + travelTime(stages[last]!.location, end, label.leave);
      if (!Number.isFinite(arrive)) continue;
      if (
        !winner ||
        label.lateness < winner.lateness ||
        (label.lateness === winner.lateness && arrive < winnerEnd)
      ) {
        winner = label;
        winnerEnd = arrive;
      }
    }
  }

  if (!winner) throw new UnreachableError();

  // Follow the parent links backwards to rebuild the order.
  const order: string[] = [];
  for (let label: Label | null = winner; label; label = label.parent)
    order.push(stages[label.stage]!.id);
  order.reverse();

  return evaluateOrder(input, order);
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
