import type { RouteResult } from '../route/types';
import type { StopState } from './engine';

/** A wait at a stop this long (minutes) is shown on the map. Shorter ones are not worth a badge. */
export const NOTABLE_WAIT_MINUTES = 5;

/**
 * What state each stop is in, for the map. One state per stop, so the marker can show it with an
 * icon and words (never colour alone). The order of the rules is the order of importance:
 *
 *   dropped  left out of the route
 *   done     already visited
 *   late     has a real problem with its opening hours (a warning, shown as one)
 *   next     today, and the first stop in order that is not done
 *   waiting  you arrive early and have to wait 5 minutes or more (not a problem)
 *   upcoming everything else
 */
export function stopStates(
  stages: ReadonlyArray<{ id: string; done: boolean; dropped: boolean }>,
  route: RouteResult | null,
  options: { today: boolean },
): Map<string, StopState> {
  const dropped = new Set(route?.dropped ?? []);
  const late = new Set<string>();
  for (const violation of route?.violations ?? []) {
    // Overtime at the end of the day belongs to the day, not to one stop.
    if ('stageId' in violation) late.add(violation.stageId);
  }
  const waiting = new Set(
    (route?.visits ?? []).filter((v) => v.waited >= NOTABLE_WAIT_MINUTES).map((v) => v.stageId),
  );

  const isDropped = (stage: { id: string; dropped: boolean }) =>
    stage.dropped || dropped.has(stage.id);
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const nextId = options.today
    ? route?.order.find((id) => {
        const stage = byId.get(id);
        return stage !== undefined && !stage.done && !isDropped(stage);
      })
    : undefined;

  return new Map(
    stages.map((stage): [string, StopState] => {
      if (isDropped(stage)) return [stage.id, 'dropped'];
      if (stage.done) return [stage.id, 'done'];
      if (late.has(stage.id)) return [stage.id, 'late'];
      if (stage.id === nextId) return [stage.id, 'next'];
      if (waiting.has(stage.id)) return [stage.id, 'waiting'];
      return [stage.id, 'upcoming'];
    }),
  );
}
