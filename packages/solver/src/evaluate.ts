import type { Minutes, SolveInput, SolveResult, Stage, Violation, Visit } from './types.js';

/** When service can start: on arrival, or when the place opens if we are early (we wait). */
export function serviceStartFor(stage: Stage, arrival: Minutes): Minutes {
  return stage.window ? Math.max(arrival, stage.window.open) : arrival;
}

/** Minutes by which a visit that ends at `departure` runs past the closing time (0 if none). */
export function latenessOf(stage: Stage, departure: Minutes): number {
  return stage.window ? Math.max(0, departure - stage.window.close) : 0;
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
    const serviceStart = serviceStartFor(stage, arrival);
    const departure = serviceStart + stage.stayMinutes;
    visits.push({ stageId: id, arrival, serviceStart, departure, waited: serviceStart - arrival });

    const minutesLate = latenessOf(stage, departure);
    if (minutesLate > 0) {
      totalLateness += minutesLate;
      // A stay longer than the whole window can never be fixed by reordering.
      const windowTooShort =
        stage.window && stage.stayMinutes > stage.window.close - stage.window.open;
      violations.push(
        windowTooShort
          ? { stageId: id, kind: 'window_too_short' }
          : { stageId: id, kind: 'closed', minutesLate },
      );
    }

    position = stage.location;
    time = departure;
  }

  return {
    order: [...order],
    visits,
    endArrival: time + input.travelTime(position, input.end, time),
    violations,
    totalLateness,
  };
}
