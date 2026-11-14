import { Check, CircleAlert } from 'lucide-react';
import { formatClock } from '../lib/dates';
import { describeRoute, stopNotes, type DayFacts } from './describe';
import type { RouteResult } from './types';

/**
 * The route in plain words, then the day as a timeline with a note under any stop with a problem.
 * Stops already visited are listed first as done; the others can be marked done with one press.
 */
export function RouteSummary({
  route,
  day,
  stopNames,
  doneStops = [],
  onToggleDone,
}: {
  route: RouteResult;
  day: DayFacts & { startName: string | null };
  stopNames: Map<string, string>;
  /** Stops already visited, in the order they were done. */
  doneStops?: Array<{ id: string; name: string }>;
  onToggleDone?: (stageId: string, done: boolean) => void;
}) {
  // After a replan mid-day the route starts where the person was, at that time.
  const startTime = route.live ? route.live.time : day.startTime;
  const startName = route.live ? 'Your location' : (day.startName ?? 'Start');
  const { headline, detail } = describeRoute({ ...day, startTime }, route);

  return (
    <section className="route-summary" aria-label="Your route">
      <h2>{headline}</h2>
      <p className="route-summary__detail">{detail}</p>
      {route.routeLineError && (
        <p role="status" className="route-summary__note">
          The order is ready, but the line could not be drawn right now.
        </p>
      )}

      <ol aria-label="Timeline" className="timeline">
        {doneStops.map((stop) => (
          <li key={stop.id} className="timeline__row timeline__row--done">
            <span className="timeline__dot timeline__dot--done" aria-hidden="true">
              <Check size={12} />
            </span>
            <span className="timeline__name">{stop.name}</span>
            <span className="timeline__time">Done</span>
            {onToggleDone && (
              <button
                type="button"
                className="timeline__toggle"
                aria-label={`Undo done for ${stop.name}`}
                onClick={() => onToggleDone(stop.id, false)}
              >
                Undo
              </button>
            )}
          </li>
        ))}
        <li className="timeline__row timeline__row--end">
          <span className="timeline__dot timeline__dot--hollow" aria-hidden="true" />
          <span className="timeline__name">{startName}</span>
          <span className="timeline__time">{formatClock(startTime)}</span>
        </li>
        {route.visits.map((visit) => {
          const notes = stopNotes(visit, route.violations);
          const name = stopNames.get(visit.stageId) ?? 'Stop';
          return (
            <li
              key={visit.stageId}
              className={notes.length > 0 ? 'timeline__row timeline__row--warn' : 'timeline__row'}
            >
              <span className="timeline__dot" aria-hidden="true" />
              <span className="timeline__name">{name}</span>
              <span className="timeline__time">{formatClock(visit.arrival)}</span>
              {onToggleDone && (
                <button
                  type="button"
                  className="timeline__toggle"
                  aria-label={`Mark ${name} as done`}
                  onClick={() => onToggleDone(visit.stageId, true)}
                >
                  Done
                </button>
              )}
              {notes.map((note) => (
                <p key={note} className="timeline__note">
                  <CircleAlert size={16} aria-hidden="true" />
                  {note}
                </p>
              ))}
            </li>
          );
        })}
        <li className="timeline__row timeline__row--end">
          <span className="timeline__dot timeline__dot--hollow" aria-hidden="true" />
          <span className="timeline__name">{day.endName ?? 'End'}</span>
          <span className="timeline__time">{formatClock(route.endArrival)}</span>
        </li>
      </ol>
    </section>
  );
}
