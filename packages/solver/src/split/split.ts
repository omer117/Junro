import { evaluateOrder } from '../evaluate.js';
import { solve } from '../solve.js';
import type { LatLng, SolveInput, SolveResult, Stage } from '../types.js';
import { InvalidInputError, MAX_STAGES } from '../validate.js';
import { pinWindow } from './pin.js';
import type { SplitInput, SplitResult } from './types.js';

/** A day with no end time is planned as if it ended at 22:00, so overtime can balance the load. */
const DEFAULT_DAY_END = 22 * 60;
/** Moves screened by the cheap estimate that are then scored exactly, per pass. */
const TOP_MOVES = 8;
/** At most this many assignments are tried one by one (then the answer is proven optimal). */
const EXHAUSTIVE_LIMIT = 20_000;
/** "No other day" regret: such a place is placed first. */
const NO_ALTERNATIVE = 1e9;
/** The cheap estimate weighs lateness far above time. */
const LATE_WEIGHT = 100_000;

/**
 * Default budget of the local search, in work units (see `workUnitsOf`). One unit is about one
 * label step of the day solver. Calibrated so the largest allowed input (10 days, 60 places)
 * finishes in about 2 to 3 seconds (measured: a 15-stage day solve is 7.4M units and about 250 ms on a developer laptop).
 */
export const DEFAULT_SPLIT_BUDGET = 40_000_000;

/** The cost of one exact day solve: the Held-Karp work, about 2^n * n^2 label steps. */
export function workUnitsOf(stageCount: number): number {
  return stageCount === 0 ? 1 : 2 ** stageCount * stageCount * stageCount;
}

type Score = [lateness: number, dropped: number, tail: number];

interface DayOutcome {
  result: SolveResult;
  lateness: number;
  dropped: number;
  travel: number;
  load: number;
}

/**
 * Decides which place goes on which day of one stay.
 *
 * Two levels: this function chooses the SET of places of each day (a heuristic: seeds, regret
 * insertion, then local search); each day's ORDER is the exact day solver (Held-Karp), which also
 * drops optional places that do not fit. Every candidate is judged by the real day solver, so
 * opening hours, bookings and day length are all seen.
 *
 * Objective, lexicographic, in whole minutes:
 *   1. total lateness (including minutes past each day's end time),
 *   2. optional places dropped,
 *   3. 2 x travel + imbalance (a minute of unevenness costs half a minute of travel).
 *
 * Pure and deterministic: no randomness and no clock (the budget counts work, not time).
 * Tiny inputs are solved by trying every assignment, so the answer is then proven optimal.
 */
export function splitSegment(input: SplitInput): SplitResult {
  const { days, places, travelTime } = input;
  const budget = input.budget ?? DEFAULT_SPLIT_BUDGET;
  const D = days.length;
  const N = places.length;

  places.forEach((place) => {
    if (place.hours.length !== D) {
      throw new InvalidInputError(`Place ${place.id}: hours must have one entry per day`);
    }
    if (place.pin && !(place.pin.day >= 0 && place.pin.day < D)) {
      throw new InvalidInputError(`Place ${place.id}: pinned to a day that does not exist`);
    }
  });

  // ---- what each place may do -------------------------------------------------------------
  const pinnedDay = (p: number) => places[p]!.pin?.day ?? -1;
  const allowedDays = places.map((place, p) =>
    pinnedDay(p) >= 0
      ? [pinnedDay(p)]
      : days.map((_, d) => d).filter((d) => !place.hours[d]?.closedAllDay),
  );
  const closedEverywhere = (p: number) => allowedDays[p]!.length === 0;

  const stageOf = (p: number, d: number): Stage => {
    const place = places[p]!;
    const pin = place.pin;
    if (pin && pin.day === d) {
      return {
        id: place.id,
        location: place.location,
        stayMinutes: place.stayMinutes,
        priority: 'must',
        windows: [pinWindow(pin.time, place.stayMinutes)],
      };
    }
    return {
      id: place.id,
      location: place.location,
      stayMinutes: place.stayMinutes,
      priority: pin ? 'must' : place.priority,
      ...place.hours[d],
    };
  };

  const problemOf = (d: number, ids: number[]): SolveInput => {
    const day = days[d]!;
    return {
      start: day.start,
      end: day.end,
      startTime: day.startTime,
      endTime: day.endTime ?? DEFAULT_DAY_END,
      stages: ids.map((p) => stageOf(p, d)),
      travelTime,
    };
  };

  // ---- exact scoring of one day, remembered ------------------------------------------------
  let workUnits = 0;
  const memo = new Map<string, DayOutcome>();
  const keyOf = (d: number, ids: number[]) => `${d}|${ids.join(',')}`;

  const exactDay = (d: number, ids: number[]): DayOutcome => {
    const key = keyOf(d, ids);
    const known = memo.get(key);
    if (known) return known;
    workUnits += workUnitsOf(ids.length);
    const result = solve(problemOf(d, ids));
    const atStops = result.visits.reduce((sum, v) => sum + (v.departure - v.arrival), 0);
    const outcome: DayOutcome = {
      result,
      lateness: result.totalLateness,
      dropped: result.dropped.length,
      travel: result.endArrival - days[d]!.startTime - atStops,
      load: result.endArrival - days[d]!.startTime,
    };
    memo.set(key, outcome);
    return outcome;
  };

  const scoreOf = (outcomes: DayOutcome[]): Score => {
    const total = outcomes.reduce((sum, o) => sum + o.load, 0);
    const imbalance = outcomes.reduce((sum, o) => sum + Math.abs(o.load * D - total), 0);
    const travel = outcomes.reduce((sum, o) => sum + o.travel, 0);
    return [
      outcomes.reduce((sum, o) => sum + o.lateness, 0),
      outcomes.reduce((sum, o) => sum + o.dropped, 0),
      2 * travel * D + imbalance,
    ];
  };

  // ---- the assignment ----------------------------------------------------------------------
  // assign[p] is the day of place p, or -1 when it is on no day.
  const assign: number[] = places.map(() => -1);
  const dayIds = (d: number) => assign.flatMap((a, p) => (a === d ? [p] : []));
  const loadOf = (d: number) => dayIds(d).length;

  let exhausted = false;

  const evaluateAssignment = (): { outcomes: DayOutcome[]; score: Score } => {
    const outcomes = days.map((_, d) => exactDay(d, dayIds(d)));
    return { outcomes, score: scoreOf(outcomes) };
  };

  const exhaustiveSize = allowedDays.reduce(
    (product, allowed, p) => (pinnedDay(p) >= 0 ? product : product * Math.max(1, allowed.length)),
    1,
  );

  if (exhaustiveSize <= EXHAUSTIVE_LIMIT) {
    // Tiny input: try every assignment (pinned places fixed, closed-everywhere places left out).
    let best: Score | null = null;
    let bestAssign: number[] = [];
    const walk = (p: number) => {
      if (p === N) {
        if (days.some((_, d) => loadOf(d) > MAX_STAGES)) return;
        const { score } = evaluateAssignment();
        if (!best || compareScores(score, best) < 0) {
          best = score;
          bestAssign = [...assign];
        }
        return;
      }
      if (closedEverywhere(p)) return walk(p + 1);
      for (const d of allowedDays[p]!) {
        assign[p] = d;
        walk(p + 1);
      }
      assign[p] = -1;
    };
    walk(0);
    bestAssign.forEach((d, p) => (assign[p] = d));
  } else {
    // The search is run from a few different starting plans (the seeds are taken from a different
    // day each time) and the best result is kept; a re-run with `current` keeps one start so the
    // plan stays stable.
    const variants = input.current ? 1 : Math.min(2 * D, 8);
    let bestOverall: Score | null = null;
    let bestAssign: number[] = [];
    for (let variant = 0; variant < variants && !exhausted; variant++) {
      assign.fill(-1);
      // ---- construction -----------------------------------------------------------------------
      const orders: number[][] = days.map(() => []);

      const dayCostOf = (d: number, order: number[]): number => {
        if (order.length === 0) return 0;
        const evaluated = evaluateOrder(
          problemOf(d, order),
          order.map((p) => places[p]!.id),
        );
        return evaluated.totalLateness * LATE_WEIGHT + (evaluated.endArrival - days[d]!.startTime);
      };

      /** A cheap look at a day with the given order: no search, just walking the order. */
      const cheapStats = (d: number, order: number[]): DayOutcome => {
        const evaluated = evaluateOrder(
          problemOf(d, order),
          order.map((p) => places[p]!.id),
        );
        const atStops = evaluated.visits.reduce((sum, v) => sum + (v.departure - v.arrival), 0);
        const load = evaluated.endArrival - days[d]!.startTime;
        return {
          result: evaluated,
          lateness: evaluated.totalLateness,
          dropped: 0,
          travel: load - atStops,
          load,
        };
      };

      /** The cheapest place for `p` in the order of day `d`: its cost and the order with it. */
      const bestInsertion = (d: number, order: number[], p: number) => {
        let best = { cost: Infinity, order: order };
        for (let at = 0; at <= order.length; at++) {
          const candidate = [...order.slice(0, at), p, ...order.slice(at)];
          const cost = dayCostOf(d, candidate);
          if (cost < best.cost) best = { cost, order: candidate };
        }
        return best;
      };

      const withoutPlace = (order: number[], p: number) => order.filter((x) => x !== p);

      // Warm start: keep where places were, then fit the new ones in.
      for (let p = 0; p < N; p++) {
        if (closedEverywhere(p)) continue;
        const was = input.current?.[places[p]!.id];
        if (pinnedDay(p) >= 0) {
          assign[p] = pinnedDay(p);
        } else if (was !== undefined && allowedDays[p]!.includes(was)) {
          assign[p] = was;
        }
      }
      for (let d = 0; d < D; d++) {
        const mine = dayIds(d);
        // Pins first by their time, then the rest as they were.
        mine.sort((a, b) => {
          const ta = places[a]!.pin?.day === d ? places[a]!.pin!.time : Infinity;
          const tb = places[b]!.pin?.day === d ? places[b]!.pin!.time : Infinity;
          return ta - tb || a - b;
        });
        orders[d] = mine;
      }

      const distance = (a: LatLng, b: LatLng) => travelTime(a, b, 0);

      // Seeds (from scratch only): one place per day that has none, farthest from what is placed.
      if (!input.current) {
        for (let k = 0; k < D; k++) {
          const d = (k + variant) % D;
          if (orders[d]!.length > 0) continue;
          // Later variants take the second-farthest place instead, for a different start.
          const ranked: Array<{ p: number; far: number }> = [];
          for (let p = 0; p < N; p++) {
            if (assign[p] !== -1 || !allowedDays[p]!.includes(d)) continue;
            const there = places[p]!.location;
            let nearest = distance(days[d]!.start, there);
            for (let q = 0; q < N; q++) {
              if (assign[q] !== -1 && q !== p)
                nearest = Math.min(nearest, distance(places[q]!.location, there));
            }
            ranked.push({ p, far: nearest });
          }
          ranked.sort((a, b) => b.far - a.far || a.p - b.p);
          const pick = ranked[Math.min(variant >= D ? 1 : 0, ranked.length - 1)]?.p ?? -1;
          if (pick >= 0) {
            assign[pick] = d;
            orders[d] = [pick];
          }
        }
      }

      // Regret insertion for everything still open.
      const open = () => assign.flatMap((a, p) => (a === -1 && !closedEverywhere(p) ? [p] : []));
      for (let todo = open(); todo.length > 0; todo = open()) {
        let chosen: { p: number; d: number; order: number[]; regret: number } | null = null;
        for (const p of todo) {
          const options = allowedDays[p]!.filter((d) => orders[d]!.length < MAX_STAGES)
            .map((d) => {
              const found = bestInsertion(d, orders[d]!, p);
              return { d, order: found.order, delta: found.cost - dayCostOf(d, orders[d]!) };
            })
            .sort((a, b) => a.delta - b.delta || a.d - b.d);
          if (options.length === 0) {
            assign[p] = -2; // no room anywhere: left out below
            continue;
          }
          const regret =
            options.length > 1 ? options[1]!.delta - options[0]!.delta : NO_ALTERNATIVE;
          if (!chosen || regret > chosen.regret) {
            chosen = { p, d: options[0]!.d, order: options[0]!.order, regret };
          }
        }
        if (!chosen) break;
        assign[chosen.p] = chosen.d;
        orders[chosen.d] = chosen.order;
      }
      // Places with no room anywhere are on no day.
      for (let p = 0; p < N; p++) if (assign[p] === -2) assign[p] = -1;

      // ---- local search, every candidate judged by the exact day solver -----------------------
      let { outcomes, score } = evaluateAssignment();
      const refreshOrders = () => {
        for (let d = 0; d < D; d++) {
          const r = outcomes[d]!.result;
          const inDay = dayIds(d);
          orders[d] = [
            ...r.order.map((id) => inDay.find((p) => places[p]!.id === id)!),
            ...inDay.filter((p) => !r.order.includes(places[p]!.id)),
          ];
        }
      };
      refreshOrders();

      type Move = { cheap: Score; changes: Array<[place: number, day: number]> };
      for (;;) {
        if (workUnits >= budget) {
          exhausted = true;
          break;
        }
        const current = orders.map((order, d) => cheapStats(d, order));
        const cheapScoreWith = (changed: Array<[number, number[]]>): Score => {
          const next = [...current];
          for (const [d, order] of changed) next[d] = cheapStats(d, order);
          return scoreOf(next);
        };
        const moves: Move[] = [];

        for (let p = 0; p < N; p++) {
          const a = assign[p]!;
          if (a < 0 || pinnedDay(p) >= 0) continue;
          const removedA = withoutPlace(orders[a]!, p);
          for (const b of allowedDays[p]!) {
            if (b === a || orders[b]!.length >= MAX_STAGES) continue;
            const into = bestInsertion(b, orders[b]!, p);
            moves.push({
              cheap: cheapScoreWith([
                [a, removedA],
                [b, into.order],
              ]),
              changes: [[p, b]],
            });
          }
          for (let q = p + 1; q < N; q++) {
            const b = assign[q]!;
            if (b < 0 || b === a || pinnedDay(q) >= 0) continue;
            if (!allowedDays[p]!.includes(b) || !allowedDays[q]!.includes(a)) continue;
            const intoA = bestInsertion(a, removedA, q);
            const intoB = bestInsertion(b, withoutPlace(orders[b]!, q), p);
            moves.push({
              cheap: cheapScoreWith([
                [a, intoA.order],
                [b, intoB.order],
              ]),
              changes: [
                [p, b],
                [q, a],
              ],
            });
          }
        }

        moves.sort((x, y) => compareScores(x.cheap, y.cheap));
        let bestMove: { score: Score; change: Move['changes'] } | null = null;
        // Moves are tried best-looking first, TOP_MOVES at a time; the next batch is only looked at
        // when none of the batch so far improves the real score.
        for (const [index, move] of moves.entries()) {
          if (index > 0 && index % TOP_MOVES === 0 && bestMove) break;
          if (workUnits >= budget) {
            exhausted = true;
            break;
          }
          const saved = move.changes.map(([p]) => assign[p]!);
          move.changes.forEach(([p, d]) => (assign[p] = d));
          const candidate = evaluateAssignment().score;
          move.changes.forEach(([p], i) => (assign[p] = saved[i]!));
          if (
            compareScores(candidate, score) < 0 &&
            (!bestMove || compareScores(candidate, bestMove.score) < 0)
          ) {
            bestMove = { score: candidate, change: move.changes };
          }
        }
        if (!bestMove) break;
        bestMove.change.forEach(([p, d]) => (assign[p] = d));
        ({ outcomes, score } = evaluateAssignment());
        refreshOrders();
        if (exhausted) break;
      }
      if (!bestOverall || compareScores(score, bestOverall) < 0) {
        bestOverall = score;
        bestAssign = [...assign];
      }
    }
    bestAssign.forEach((d, p) => (assign[p] = d));
  }

  // ---- the answer ----------------------------------------------------------------------------
  const { outcomes } = evaluateAssignment();
  const leftOut: SplitResult['leftOut'] = [];
  places.forEach((place, p) => {
    if (closedEverywhere(p)) leftOut.push({ id: place.id, reason: 'closed_all_days' });
    else if (assign[p] === -1) leftOut.push({ id: place.id, reason: 'did_not_fit' });
  });
  // A place the day solver dropped is on no day either: say so.
  outcomes.forEach((outcome) => {
    for (const id of outcome.result.dropped) leftOut.push({ id, reason: 'did_not_fit' });
  });
  const inputOrder = new Map(places.map((place, p) => [place.id, p]));
  leftOut.sort((a, b) => inputOrder.get(a.id)! - inputOrder.get(b.id)!);

  const [lateness, dropped] = scoreOf(outcomes);
  const total = outcomes.reduce((sum, o) => sum + o.load, 0);
  return {
    days: days.map((day, d) => ({ dayId: day.id, result: outcomes[d]!.result })),
    leftOut,
    score: {
      lateness,
      droppedOptional: dropped,
      travel: outcomes.reduce((sum, o) => sum + o.travel, 0),
      imbalance: Math.round(outcomes.reduce((sum, o) => sum + Math.abs(o.load * D - total), 0) / D),
    },
    exhausted,
    workUnits,
  };
}

function compareScores(a: Score, b: Score): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
