import type { Minutes, SolveInput, SolveResult, Stage, Violation, Visit } from './types.js';

export interface VisitTiming {
  serviceStart: Minutes;
  departure: Minutes;
  /** Minutes past the closing time of the chosen window (0 if none). */
  lateness: number;
  /** Index of the chosen window, or -1 when the place has no limit. */
  windowIndex: number;
}

/**
 * The one rule for timing a visit, used by both `evaluateOrder` and the DP so they cannot disagree.
 *
 * For each opening window: we start at max(arrival, open) (we wait if early) and would be late by
 * max(0, start + stay - close). We take the window with the least lateness, the earliest on a tie.
 * So: the earliest window the whole stay fits in (waiting if needed), else the least late one.
 *
 * Both `departure` and `lateness` never go down when the arrival goes up. That is what keeps the
 * DP exact: arriving earlier is never worse.
 */
export function visitAt(stage: Stage, arrival: Minutes): VisitTiming {
  const windows = stage.windows;
  if (!windows || windows.length === 0 || stage.closedAllDay) {
    return {
      serviceStart: arrival,
      departure: arrival + stage.stayMinutes,
      lateness: 0,
      windowIndex: -1,
    };
  }
  let best: VisitTiming | null = null;
  for (let k = 0; k < windows.length; k++) {
    const window = windows[k]!;
    const serviceStart = Math.max(arrival, window.open);
    const departure = serviceStart + stage.stayMinutes;
    const lateness = Math.max(0, departure - window.close);
    if (!best || lateness < best.lateness)
      best = { serviceStart, departure, lateness, windowIndex: k };
  }
  return best!;
}

/**
 * Walks a given order and computes the timeline: when we arrive at each stage,
 * when we leave it, and when we reach the end point.
 *
 * This is the single source of truth for timing. `solve` finds the best order,
 * then hands it here to produce the result, so the DP and the output can never
 * disagree about the numbers.
 */
export function evaluateOrder(input: SolveInput, order: string[]): SolveResult {
  const byId = new Map(input.stages.map((stage) => [stage.id, stage]));

  let position = input.start;
  let time = input.startTime;
  const visits: Visit[] = [];
  const violations: Violation[] = [];
  let totalLateness = 0;

  for (const id of order) {
    const stage = byId.get(id);
    if (!stage) throw new Error(`Unknown stage id: ${id}`);

    const arrival = time + input.travelTime(position, stage.location, time);
    const { serviceStart, departure, lateness: minutesLate, windowIndex } = visitAt(stage, arrival);
    visits.push({
      stageId: id,
      arrival,
      serviceStart,
      departure,
      waited: serviceStart - arrival,
      ...(windowIndex >= 0 ? { window: stage.windows![windowIndex]! } : {}),
    });

    // Closed all day is a flag only: it adds no lateness, so it cannot bend the order of the
    // other stages (it would be the same penalty in every order).
    if (stage.closedAllDay) {
      violations.push({ stageId: id, kind: 'closed_all_day' });
    } else if (minutesLate > 0) {
      totalLateness += minutesLate;
      // A stay longer than every window of the day can never be fixed by reordering.
      const windowTooShort = stage.windows!.every(
        (window) => stage.stayMinutes > window.close - window.open,
      );
      violations.push(
        windowTooShort
          ? { stageId: id, kind: 'window_too_short' }
          : { stageId: id, kind: 'closed', minutesLate },
      );
    }

    position = stage.location;
    time = departure;
  }

  const endArrival = time + input.travelTime(position, input.end, time);

  // Reaching the end point after the day end time counts as lateness too, so that the solver can
  // trade it against dropping an optional stop.
  const overtime = input.endTime === undefined ? 0 : Math.max(0, endArrival - input.endTime);
  if (overtime > 0) {
    totalLateness += overtime;
    violations.push({ kind: 'past_day_end', minutesLate: overtime });
  }

  return { order: [...order], visits, endArrival, violations, totalLateness, dropped: [] };
}
