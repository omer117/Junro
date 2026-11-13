import { ChevronLeft, Route as RouteIcon, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/api';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import { formatClock, formatDayTitle } from '../lib/dates';
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

/** Room kept clear on the map for the sheet at the bottom and the search on top (pixels). */
const MAP_PADDING = { top: 110, right: 32, bottom: 400, left: 32 };

/** How long the route line takes to draw itself, plus a little. */
const ANIMATION_MS = 2000;

/** A wait at a stop longer than this is flagged on the map, like a problem. */
const NOTABLE_WAIT_MINUTES = 5;

const MODES: Array<{ mode: TravelMode; label: string }> = [
  { mode: 'walking', label: 'Walking' },
  { mode: 'driving', label: 'Driving' },
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

  const findRoute = () =>
    solve.mutate('full', {
      onSuccess: () => {
        setEditing(false);
        setAnimate(true);
      },
    });

  const addProblem =
    addStage.error instanceof ApiError && addStage.error.code === 'day_full'
      ? 'A day can have at most 15 stops.'
      : addStage.isError
        ? 'Could not add the stop. Try again.'
        : null;
  const problem = addProblem ?? (solve.isError ? solveProblem(solve.error) : null);

  const showSummary = savedRoute !== null && !editing;

  return (
    <div className="day-screen">
      <MapView
        markers={markers}
        routeLine={savedRoute?.routeLine ?? null}
        animateRoute={animate}
        padding={MAP_PADDING}
      />

      <div className="day-screen__top">
        <Link to="/" className="day-screen__back" aria-label="Back to your trips">
          <ChevronLeft size={24} aria-hidden="true" />
        </Link>
        <PlaceSearch
          label="Add a stop"
          placeholder="Add a stop — ramen, temple, bar…"
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

        <div role="radiogroup" aria-label="Travel mode" className="mode-chips">
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={day.data.travelMode === mode}
              className="mode-chip"
              disabled={updateDay.isPending}
              onClick={() => {
                if (day.data.travelMode !== mode) updateDay.mutate({ travelMode: mode });
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked="false"
            className="mode-chip mode-chip--soon"
            disabled
          >
            Transit · soon
          </button>
        </div>

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
              }}
              stopNames={stopNames}
            />
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

            <button
              type="button"
              className="button button--accent button--wide"
              disabled={stages.length === 0 || solve.isPending}
              aria-busy={solve.isPending}
              onClick={findRoute}
            >
              <RouteIcon size={20} aria-hidden="true" />
              {solve.isPending
                ? 'Finding your route…'
                : savedRoute
                  ? 'Recalculate route'
                  : 'Find my route'}
            </button>
            {stages.length === 0 && <p className="day-sheet__hint">Add a stop to find a route.</p>}
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
