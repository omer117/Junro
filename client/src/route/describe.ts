import { formatClock } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import type { TravelMode } from '../trips/types';
import type { RouteResult, Violation, Visit } from './types';

/** A wait shorter than this is not worth mentioning. */
const NOTABLE_WAIT_MINUTES = 5;

/** Minutes spent on the way: all of the day except the time spent at the stops (staying or waiting). */
export function travelMinutes(startTime: number, route: RouteResult): number {
  const atStops = route.visits.reduce((sum, visit) => sum + (visit.departure - visit.arrival), 0);
  return route.endArrival - startTime - atStops;
}

export interface DayFacts {
  startTime: number;
  travelMode: TravelMode;
  endName: string | null;
  /** The day ends where it began (the hotel), so it is "back at", not "finish at". */
  returnsToStart: boolean;
}

/** The result in words a person would say, not as numbers. */
export function describeRoute(
  day: DayFacts,
  route: RouteResult,
): { headline: string; detail: string } {
  const place = day.endName ?? (day.returnsToStart ? 'the start' : 'the end');
  const verb = day.returnsToStart ? 'Back at' : 'Finish at';
  const nextDay = route.endArrival >= 1440 ? ' the next day' : '';
  const travel = formatDuration(travelMinutes(day.startTime, route));
  return {
    headline: `${verb} ${place} by ${formatClock(route.endArrival)}${nextDay}`,
    detail:
      day.travelMode === 'transit'
        ? `${travel} getting around, the rest is yours`
        : `${travel} of ${day.travelMode === 'driving' ? 'driving' : 'walking'}, the rest is yours`,
  };
}

/** What to tell the person about one stop: problems with its opening hours, and a long wait. */
export function stopNotes(visit: Visit, violations: Violation[]): string[] {
  const notes: string[] = [];
  for (const violation of violations) {
    if (violation.stageId !== visit.stageId) continue;
    if (violation.kind === 'closed') {
      notes.push(`It closes before you are done: about ${violation.minutesLate} min over.`);
    } else if (violation.kind === 'closed_all_day') {
      notes.push('Closed on this day.');
    } else {
      notes.push('Its opening hours are shorter than your stay.');
    }
  }
  if (visit.waited >= NOTABLE_WAIT_MINUTES) {
    notes.push(
      `Opens at ${formatClock(visit.serviceStart)}. You arrive at ${formatClock(visit.arrival)} and wait ${formatDuration(visit.waited)}.`,
    );
  }
  return notes;
}
