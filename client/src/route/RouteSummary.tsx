import { Check, CircleAlert, ExternalLink, Footprints, TrainFront } from 'lucide-react';
import { Fragment } from 'react';
import { formatClock } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { googleMapsDirectionsUrl, type DirectionsPoint } from '../lib/mapsLink';
import { describeRoute, stopNotes, type DayFacts } from './describe';
import { LegWays } from './LegWays';
import type { RouteResult } from './types';

/**
 * The route in plain words, then the day as a timeline with a note under any stop with a problem.
 * Stops already visited are listed first as done; the others can be marked done with one press.
 */
export function RouteSummary({
  route,
  day,
  stopNames,
  dayId,
  stopPlaces,
  doneStops = [],
  onToggleDone,
}: {
  route: RouteResult;
  day: DayFacts & {
    startName: string | null;
    /** Where the day starts and ends, for the links to Google Maps. */
    start?: DirectionsPoint;
    end?: DirectionsPoint;
  };
  stopNames: Map<string, string>;
  /** Where each stop is (and Google's id for it), for the links to Google Maps. */
  stopPlaces?: Map<string, DirectionsPoint>;
  /** Public transport days: the day, so the other ways of a leg can be asked for. */
  dayId?: string;
  /** Stops already visited, in the order they were done. */
  doneStops?: Array<{ id: string; name: string }>;
  onToggleDone?: (stageId: string, done: boolean) => void;
}) {
  // After a replan mid-day the route starts where the person was, at that time.
  const startTime = route.live ? route.live.time : day.startTime;
  const startName = route.live ? 'Your location' : (day.startName ?? 'Start');
  const { headline, detail } = describeRoute({ ...day, startTime }, route);

  // The leg after each place of the route (start, every stop in order): how you get to the next.
  const names = [
    startName,
    ...route.visits.map((visit) => stopNames.get(visit.stageId) ?? 'Stop'),
    day.endName ?? 'End',
  ];
  const legAfter = (index: number) => {
    const leg = route.legs?.[index];
    if (!leg) return null;
    const Icon = leg.mode === 'walk' ? Footprints : TrainFront;
    // The place each end of this leg is at, for the link to Google Maps. When the day was
    // replanned from where you are, the route starts at your location.
    const from =
      index === 0
        ? route.live
          ? { lat: route.live.lat, lng: route.live.lng }
          : day.start
        : stopPlaces?.get(route.visits[index - 1]!.stageId);
    const to =
      index === route.visits.length ? day.end : stopPlaces?.get(route.visits[index]!.stageId);
    // Where Google has no public transport data through its API, Google Maps itself still does.
    const how = leg.mode === 'transit' || route.transitAvailable === false ? 'transit' : 'walking';
    // The leg starts when you leave the place before it.
    const at = index === 0 ? startTime : route.visits[index - 1]!.departure;
    return (
      <li className="timeline__leg">
        <Icon size={16} aria-hidden="true" />
        <span>{`${leg.mode === 'walk' ? 'Walk' : 'Transit'} · ${formatDuration(leg.minutes)}`}</span>
        {from && to && (
          <a
            className="timeline__maps-link"
            href={googleMapsDirectionsUrl({ from, to, mode: how })}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${names[index]!} to ${names[index + 1]!} in Google Maps`}
          >
            <ExternalLink size={14} aria-hidden="true" />
            Open in Google Maps
          </a>
        )}
        {leg.mode === 'transit' && dayId && (
          <LegWays
            dayId={dayId}
            index={index}
            at={Math.round(at)}
            from={names[index]!}
            to={names[index + 1]!}
          />
        )}
      </li>
    );
  };

  // Stops already visited. They happened before the plan below: after the start of the day, or,
  // when the day was replanned from where you are, before "Your location".
  const doneRows = doneStops.map((stop) => (
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
  ));

  return (
    <section className="route-summary" aria-label="Your route">
      <h2>{headline}</h2>
      <p className="route-summary__detail">{detail}</p>
      {route.transitAvailable === false && (
        <p role="status" className="route-summary__note">
          Public transport is not available for these places, so every leg is on foot. Google does
          not provide it in some countries, such as Japan and South Korea.
        </p>
      )}
      {route.routeLineError && (
        <p role="status" className="route-summary__note">
          The order is ready, but the line could not be drawn right now.
        </p>
      )}

      <ol aria-label="Timeline" className="timeline">
        {route.live && doneRows}
        <li className="timeline__row timeline__row--end">
          <span className="timeline__dot timeline__dot--hollow" aria-hidden="true" />
          <span className="timeline__name">{startName}</span>
          <span className="timeline__time">{formatClock(startTime)}</span>
        </li>
        {!route.live && doneRows}
        {legAfter(0)}
        {route.visits.map((visit, visitIndex) => {
          const notes = stopNotes(visit, route.violations);
          const name = stopNames.get(visit.stageId) ?? 'Stop';
          return (
            <Fragment key={visit.stageId}>
              <li
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
              {legAfter(visitIndex + 1)}
            </Fragment>
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
