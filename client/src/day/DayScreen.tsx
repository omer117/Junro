import { ChevronLeft, LocateFixed, Route as RouteIcon, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/api';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import { formatClock, formatDayTitle, todayString } from '../lib/dates';
import { LocationError, currentPosition } from '../lib/geolocation';
import { RadioChips } from '../lib/RadioChips';
import { useMediaQuery } from '../lib/useMediaQuery';
import { isSamePlace } from '../map/endpoints';
import type { MapMarker } from '../map/engine';
import { MapView } from '../map/MapView';
import type { Place } from '../places/api';
import { PlaceSearch } from '../places/PlaceSearch';
import { useRoute, useSolve } from '../route/api';
import { RouteSummary } from '../route/RouteSummary';
import type { TravelMode } from '../trips/types';
import {
  useAddStage,
  useDay,
  useDeleteStage,
  useStages,
  useUpdateDay,
  useUpdateStage,
} from './api';
import type { Stage } from './types';
import './day.css';

/** The width from which the plan is a side panel next to the map instead of a sheet at the bottom. */
const WIDE_SCREEN = '(min-width: 52rem)';

/**
 * Room kept clear on the map (pixels): on a phone the sheet covers the bottom and the search the
 * top; on a computer the panel covers the left (26rem plus its margins) and the search the top.
 */
const PHONE_PADDING = { top: 110, right: 32, bottom: 400, left: 32 };
const COMPUTER_PADDING = { top: 110, right: 48, bottom: 48, left: 480 };

/** How long the route line takes to draw itself, plus a little. */
const ANIMATION_MS = 2000;

/** A wait at a stop longer than this is flagged on the map, like a problem. */
const NOTABLE_WAIT_MINUTES = 5;

const MODES: Array<{ value: TravelMode; label: string }> = [
  { value: 'walking', label: 'Walking' },
  { value: 'driving', label: 'Driving' },
  { value: 'transit', label: 'Transit' },
];

/** Stops in route order; before a route exists, in the order they were added. */
function inRouteOrder(stages: Stage[]): Stage[] {
  return [...stages].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
  );
}

function solveProblem(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'quota_reached':
        return 'The monthly limit for route finding has been reached. Try again next month.';
      case 'rate_limited':
        return 'Too many route calculations. Wait a moment and try again.';
      case 'unreachable':
        return 'No route connects these stops. Check that every place can be reached by walking or driving.';
      case 'google_unavailable':
      case 'google_rejected':
        return 'Could not reach Google to work out the route. Try again in a moment.';
      case 'google_not_configured':
        return 'Route finding is not available right now.';
    }
  }
  return 'Could not find a route. Try again.';
}

/** One day: the map with its stops, and a sheet to plan it. */
export function DayScreen() {
  const { dayId } = useParams();
  const day = useDay(dayId);
  const stagesQuery = useStages(dayId);
  const route = useRoute(dayId);
  const addStage = useAddStage(dayId ?? '');
  const updateStage = useUpdateStage(dayId ?? '');
  const deleteStage = useDeleteStage(dayId ?? '');
  const updateDay = useUpdateDay(dayId ?? '');
  const solve = useSolve(dayId ?? '');
  const [pending, setPending] = useState<Place | null>(null);
  const [editing, setEditing] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const wide = useMediaQuery(WIDE_SCREEN);

  // The line draws itself once, right after "Find my route", and not again when the day is reopened.
  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setAnimate(false), ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [animate]);

  const stages = useMemo(() => inRouteOrder(stagesQuery.data ?? []), [stagesQuery.data]);
  const savedRoute = route.data ?? null;
  // Numbers on the map mean a route exists: every stop has a place in it.
  const hasRoute = stages.length > 0 && stages.every((stage) => stage.position !== null);

  const stopPlaces = useMemo(
    () =>
      new Map(
        stages.map((stage) => [
          stage.id,
          {
            lat: stage.place.lat,
            lng: stage.place.lng,
            googlePlaceId: stage.place.googlePlaceId,
          },
        ]),
      ),
    [stages],
  );

  const stopNames = useMemo(
    () => new Map(stages.map((stage) => [stage.id, stage.place.name])),
    [stages],
  );

  const markers = useMemo<MapMarker[]>(() => {
    if (!day.data) return [];
    // A stop is flagged on the map when it has a problem or a long wait.
    const flagged = new Set<string>();
    for (const violation of savedRoute?.violations ?? []) flagged.add(violation.stageId);
    for (const visit of savedRoute?.visits ?? []) {
      if (visit.waited >= NOTABLE_WAIT_MINUTES) flagged.add(visit.stageId);
    }
    return [
      {
        id: 'start',
        kind: 'start',
        position: day.data.start,
        label: `Start · ${formatClock(day.data.startTime)}`,
      },
      ...stages.map((stage, index): MapMarker => ({
        id: stage.id,
        kind: 'stage',
        position: { lat: stage.place.lat, lng: stage.place.lng },
        name: stage.place.name,
        category: stage.category,
        ...(hasRoute ? { number: index + 1 } : {}),
        ...(flagged.has(stage.id) ? { warning: true } : {}),
        ...(stage.done ? { done: true } : {}),
      })),
      {
        id: 'end',
        kind: 'end',
        position: day.data.end,
        label: `End · ${day.data.endName ?? 'end'}`,
      },
    ];
  }, [day.data, stages, hasRoute, savedRoute]);

  if (day.isPending) return <p role="status">Loading the day…</p>;
  if (day.isError || !day.data) {
    return (
      <main className="day-error">
        <p role="alert">Could not find this day.</p>
        <Link to="/" className="button button--dark">
          Back to your trips
        </Link>
      </main>
    );
  }

  const chooseCategory = (category: Category) => {
    if (!pending) return;
    addStage.mutate({ placeId: pending.id, category }, { onSuccess: () => setPending(null) });
  };

  const findRoute = (mode: 'full' | 'minimal') =>
    solve.mutate(mode, {
      onSuccess: () => {
        setEditing(false);
        setAnimate(true);
      },
    });

  // Replan the rest of the day from where the person is, at the time it is now.
  const replanFromHere = async () => {
    setLocationProblem(null);
    setLocating(true);
    try {
      const from = await currentPosition();
      const clock = new Date();
      const now = clock.getHours() * 60 + clock.getMinutes();
      solve.mutate(
        { mode: 'full', from, now },
        {
          onSuccess: () => {
            setEditing(false);
            setAnimate(true);
          },
        },
      );
    } catch (error) {
      setLocationProblem(
        error instanceof LocationError && error.reason === 'denied'
          ? 'Allow location for this site in your browser (the icon next to the address), then try again.'
          : error instanceof LocationError && error.reason === 'timeout'
            ? 'No location yet. If your browser is asking for permission, allow it, then try again.'
            : error instanceof LocationError && error.reason === 'unsupported'
              ? 'This browser cannot share your location.'
              : 'Could not find where you are. Move to an open spot and try again.',
      );
    } finally {
      setLocating(false);
    }
  };

  const addProblem =
    addStage.error instanceof ApiError && addStage.error.code === 'day_full'
      ? 'A day can have at most 15 stops.'
      : addStage.isError
        ? 'Could not add the stop. Try again.'
        : null;
  const problem = addProblem ?? (solve.isError ? solveProblem(solve.error) : null);

  const showSummary = savedRoute !== null && !editing;
  const doneStops = stages
    .filter((stage) => stage.done)
    .map((stage) => ({ id: stage.id, name: stage.place.name }));

  // Some stops have their place in a route and some do not: stops were added to a day that
  // already had a route. The person chooses how to fit them in.
  const placed = stages.filter((stage) => stage.position !== null).length;
  const added = stages.length - placed;
  const partlyRouted = placed > 0 && added > 0;

  return (
    <div className="day-screen" data-layout={wide ? 'wide' : 'narrow'}>
      <MapView
        markers={markers}
        routeLine={savedRoute?.routeLine ?? null}
        animateRoute={animate}
        padding={wide ? COMPUTER_PADDING : PHONE_PADDING}
      />

      <div className="day-screen__top">
        <Link to="/" className="day-screen__back" aria-label="Back to your trips">
          <ChevronLeft size={24} aria-hidden="true" />
        </Link>
        <PlaceSearch
          label="Add a stop"
          placeholder="Add a stop"
          near={day.data.start}
          onPick={(place) => {
            addStage.reset();
            setPending(place);
            setEditing(true);
          }}
        />
      </div>

      <section className="day-sheet" aria-label="Plan this day">
        <div className="day-sheet__handle" aria-hidden="true" />

        <div className="day-sheet__head">
          <h1>{formatDayTitle(day.data.date)}</h1>
          <span>
            {stages.length} {stages.length === 1 ? 'stop' : 'stops'}
          </span>
        </div>

        <RadioChips
          label="Travel mode"
          activation="manual"
          options={MODES}
          value={day.data.travelMode}
          disabled={updateDay.isPending}
          onChange={(mode) => updateDay.mutate({ travelMode: mode })}
        />

        {problem && <p role="alert">{problem}</p>}

        {showSummary ? (
          <>
            <RouteSummary
              route={savedRoute}
              day={{
                startTime: day.data.startTime,
                travelMode: day.data.travelMode,
                startName: day.data.startName,
                endName: day.data.endName,
                returnsToStart: isSamePlace(day.data.start, day.data.end),
                start: day.data.start,
                end: day.data.end,
              }}
              stopNames={stopNames}
              stopPlaces={stopPlaces}
              dayId={day.data.id}
              doneStops={doneStops}
              onToggleDone={(id, done) => updateStage.mutate({ id, done })}
            />
            {day.data.date === todayString() && (
              <section className="live-plan" aria-labelledby="live-heading">
                <h2 id="live-heading">Already on your way?</h2>
                <p>
                  Junro uses your location once, right now, to plan the rest of your day. It is not
                  saved.
                </p>
                <button
                  type="button"
                  className="button button--outline"
                  disabled={locating || solve.isPending}
                  aria-busy={locating}
                  onClick={() => void replanFromHere()}
                >
                  <LocateFixed size={20} aria-hidden="true" />
                  {locating ? 'Finding you…' : 'Recalculate from here'}
                </button>
                {locationProblem && <p role="alert">{locationProblem}</p>}
              </section>
            )}
            {savedRoute.routeLine === null && !savedRoute.routeLineError && (
              <button
                type="button"
                className="button button--outline"
                disabled={solve.isPending}
                onClick={() => findRoute('minimal')}
              >
                Redraw the line
              </button>
            )}
            <button
              type="button"
              className="button button--outline"
              onClick={() => setEditing(true)}
            >
              Edit day
            </button>
          </>
        ) : (
          <>
            {pending && (
              <section className="category-chooser" aria-labelledby="kind-heading">
                <h2 id="kind-heading">What kind of place is {pending.name}?</h2>
                <div className="category-chooser__options">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      disabled={addStage.isPending}
                      onClick={() => chooseCategory(category)}
                    >
                      <CategoryIcon category={category} />
                      {CATEGORY_LABELS[category]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="button button--outline"
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </section>
            )}

            {stages.length === 0 ? (
              <p className="day-sheet__empty">No stops yet. Search above to add the first one.</p>
            ) : (
              <ul aria-label="Stops" className="stop-list">
                {stages.map((stage) => (
                  <li key={stage.id}>
                    <CategoryIcon category={stage.category} />
                    <span className="stop-list__name">{stage.place.name}</span>
                    <select
                      aria-label={`Category for ${stage.place.name}`}
                      value={stage.category}
                      onChange={(event) =>
                        updateStage.mutate({
                          id: stage.id,
                          category: event.target.value as Category,
                        })
                      }
                    >
                      {CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="stop-list__remove"
                      aria-label={`Remove ${stage.place.name}`}
                      onClick={() => deleteStage.mutate(stage.id)}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {partlyRouted ? (
              <section className="edit-choice" aria-labelledby="update-heading">
                <h2 id="update-heading">Update your route</h2>
                <p>
                  You added {added} {added === 1 ? 'stop' : 'stops'} to a day that already has a
                  route. How should {added === 1 ? 'it' : 'they'} fit in?
                </p>
                <button
                  type="button"
                  className="edit-choice__option"
                  disabled={solve.isPending}
                  onClick={() => findRoute('minimal')}
                >
                  <strong>Keep my order</strong>
                  <span>
                    New stops go where they add the least time. Everything else stays put.
                  </span>
                </button>
                <button
                  type="button"
                  className="edit-choice__option"
                  disabled={solve.isPending}
                  onClick={() => findRoute('full')}
                >
                  <strong>Recalculate everything</strong>
                  <span>Junro finds the fastest order again, and may reorder your day.</span>
                </button>
              </section>
            ) : (
              <>
                <button
                  type="button"
                  className="button button--accent button--wide"
                  disabled={stages.length === 0 || solve.isPending}
                  aria-busy={solve.isPending}
                  onClick={() => findRoute('full')}
                >
                  <RouteIcon size={20} aria-hidden="true" />
                  {solve.isPending
                    ? 'Finding your route…'
                    : savedRoute
                      ? 'Recalculate route'
                      : 'Find my route'}
                </button>
                {stages.length === 0 && (
                  <p className="day-sheet__hint">Add a stop to find a route.</p>
                )}
              </>
            )}
            {savedRoute && (
              <button
                type="button"
                className="button button--outline"
                onClick={() => setEditing(false)}
              >
                Back to the route
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
