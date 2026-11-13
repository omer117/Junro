import { CircleAlert } from 'lucide-react';
import { formatClock } from '../lib/dates';
import { describeRoute, stopNotes, type DayFacts } from './describe';
import type { RouteResult } from './types';

/** The route in plain words, then the day as a timeline with a note under any stop with a problem. */
export function RouteSummary({
  route,
  day,
  stopNames,
}: {
  route: RouteResult;
  day: DayFacts & { startName: string | null };
  stopNames: Map<string, string>;
}) {
  const { headline, detail } = describeRoute(day, route);

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
        <li className="timeline__row timeline__row--end">
          <span className="timeline__dot timeline__dot--hollow" aria-hidden="true" />
          <span className="timeline__name">{day.startName ?? 'Start'}</span>
          <span className="timeline__time">{formatClock(day.startTime)}</span>
        </li>
        {route.visits.map((visit) => {
          const notes = stopNotes(visit, route.violations);
          return (
            <li
              key={visit.stageId}
              className={notes.length > 0 ? 'timeline__row timeline__row--warn' : 'timeline__row'}
            >
              <span className="timeline__dot" aria-hidden="true" />
              <span className="timeline__name">{stopNames.get(visit.stageId) ?? 'Stop'}</span>
              <span className="timeline__time">{formatClock(visit.arrival)}</span>
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
