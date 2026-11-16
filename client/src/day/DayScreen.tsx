import { CalendarClock, ChevronLeft, LocateFixed, Route as RouteIcon, Trash2 } from 'lucide-react';
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
import type { MapMarker, RouteLeg } from '../map/engine';
import { MapView } from '../map/MapView';
import { buildRouteLegs } from '../map/routeLegs';
import { stopStates } from '../map/stopStates';
import type { Place } from '../places/api';
import { PlaceSearch } from '../places/PlaceSearch';
import { useRoute, useSolve } from '../route/api';
import { RouteSummary } from '../route/RouteSummary';
import { useStay } from '../stay/api';
import { paletteFor, paletteStyle } from '../styles/palettes';
import { useTrips } from '../trips/api';
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

const PRIORITIES: Array<{ value: 'must' | 'optional'; label: string }> = [
  { value: 'must', label: 'Must' },
  { value: 'optional', label: 'If time' },
];

/** "09:30" as minutes since midnight. */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight as "09:30", for a time input. */
function timeOf(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

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
  // The other days of the stay (when this day is part of one): a stop can move to them.
  const stay = useStay(day.data?.segmentId);
  // The trip's colours (from its destination country): the trips list is already cached from home.
  const trips = useTrips();
  const solve = useSolve(dayId ?? '');
  const [pending, setPending] = useState<Place | null>(null);
  const [editing, setEditing] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [locating, setLocating] = useState(false);
  // The day end time as typed; it follows the saved value when that changes.
  const [endTimeText, setEndTimeText] = useState('');
  const savedEndTime = day.data?.endTime;
  useEffect(() => {
    setEndTimeText(savedEndTime != null ? timeOf(savedEndTime) : '');
  }, [savedEndTime]);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  // The stop chosen on the map or in the plan (they follow each other).
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  // Stops that were left out have no place in the route (and are listed on their own).
  const routed = useMemo(() => stages.filter((stage) => !stage.dropped), [stages]);
  const hasRoute = routed.length > 0 && routed.every((stage) => stage.position !== null);

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
    const states = stopStates(stages, savedRoute, { today: day.data.date === todayString() });
    return [
      {
        id: 'start',
        kind: 'start',
        position: day.data.start,
        label: `${day.data.startName ?? 'Start'} · ${formatClock(day.data.startTime)}`,
      },
      ...stages.map((stage): MapMarker => ({
        id: stage.id,
        kind: 'stage',
        position: { lat: stage.place.lat, lng: stage.place.lng },
        name: stage.place.name,
        category: stage.category,
        ...(hasRoute && !stage.dropped ? { number: routed.indexOf(stage) + 1 } : {}),
        state: states.get(stage.id) ?? 'upcoming',
      })),
      {
        id: 'end',
        kind: 'end',
        position: day.data.end,
        label: `End · ${day.data.endName ?? 'end'}`,
      },
    ];
  }, [day.data, stages, routed, hasRoute, savedRoute]);

  // The route as legs, each in the style of how it is travelled (split from the one line).
  const routeLegs = useMemo<RouteLeg[] | null>(() => {
    if (!day.data || !savedRoute?.routeLine) return null;
    const where = new Map(stages.map((stage) => [stage.id, stage.place]));
    const points = [
      savedRoute.live ? { lat: savedRoute.live.lat, lng: savedRoute.live.lng } : day.data.start,
      ...savedRoute.visits.flatMap((visit) => {
        const place = where.get(visit.stageId);
        return place ? [{ lat: place.lat, lng: place.lng }] : [];
      }),
      day.data.end,
    ];
    // A public transport day knows each leg; any other day travels every leg the same way.
    const dayMode: RouteLeg['mode'] =
      day.data.travelMode === 'driving'
        ? 'drive'
        : day.data.travelMode === 'walking'
          ? 'walk'
          : 'transit';
    const modes = points.slice(1).map((_, i) => savedRoute.legs?.[i]?.mode ?? dayMode);
    return buildRouteLegs({ line: savedRoute.routeLine, points, modes });
  }, [day.data, savedRoute, stages]);

  // Choosing a stop on the map brings its row into view in the plan.
  useEffect(() => {
    if (!selectedId) return;
    document.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

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
  const droppedStops = stages
    .filter((stage) => stage.dropped)
    .map((stage) => ({ id: stage.id, name: stage.place.name }));
  const doneStops = stages
    .filter((stage) => stage.done)
    .map((stage) => ({ id: stage.id, name: stage.place.name }));

  // Some stops have their place in a route and some do not: stops were added to a day that
  // already had a route. The person chooses how to fit them in.
  const placed = stages.filter((stage) => stage.position !== null).length;
  const added = stages.filter((stage) => stage.position === null && !stage.dropped).length;
  const partlyRouted = placed > 0 && added > 0;

  const palette = paletteFor(
    trips.data?.find((trip) => trip.id === day.data.tripId)?.destination?.countryCode,
  );
  const themed = palette.id !== 'golden-hour';

  return (
    <div
      className="day-screen"
      data-layout={wide ? 'wide' : 'narrow'}
      {...(themed ? { style: paletteStyle(palette) } : {})}
    >
      <MapView
        markers={markers}
        route={routeLegs}
        baseStyle={day.data.travelMode === 'transit' ? 'transit' : 'default'}
        {...(themed ? { accent: palette.accent } : {})}
        selectedId={selectedId}
        onSelect={setSelectedId}
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

        <div className="day-end">
          <label htmlFor="day-end-time">Day ends at (optional)</label>
          <input
            id="day-end-time"
            type="time"
            value={endTimeText}
            onChange={(event) => {
              setEndTimeText(event.target.value);
              // A time input only sends a complete, valid time; an unfinished one is empty.
              if (event.target.value !== '') {
                updateDay.mutate({ endTime: minutesOf(event.target.value) });
              }
            }}
          />
          {day.data.endTime != null && (
            <button
              type="button"
              className="button button--outline"
              onClick={() => {
                setEndTimeText('');
                updateDay.mutate({ endTime: null });
              }}
            >
              No end time
            </button>
          )}
        </div>
        {updateDay.isError && (
          <p role="alert">
            {updateDay.error instanceof ApiError && updateDay.error.code === 'validation_error'
              ? 'The day must end after it starts.'
              : 'Could not change the day. Try again.'}
          </p>
        )}

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
                start: {
                  ...day.data.start,
                  ...(day.data.startPlaceId ? { googlePlaceId: day.data.startPlaceId } : {}),
                },
                end: {
                  ...day.data.end,
                  ...(day.data.endPlaceId ? { googlePlaceId: day.data.endPlaceId } : {}),
                },
              }}
              stopNames={stopNames}
              stopPlaces={stopPlaces}
              dayId={day.data.id}
              doneStops={doneStops}
              selectedId={selectedId}
              onSelect={setSelectedId}
              droppedStops={droppedStops}
              onMakeMust={(id) =>
                updateStage.mutate({ id, priority: 'must' }, { onSuccess: () => findRoute('full') })
              }
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
                  <li key={stage.id} aria-current={selectedId === stage.id ? 'true' : undefined}>
                    <CategoryIcon category={stage.category} />
                    <button
                      type="button"
                      className="stop-list__name stop-list__select"
                      aria-pressed={selectedId === stage.id}
                      onClick={() => setSelectedId(selectedId === stage.id ? null : stage.id)}
                    >
                      {stage.place.name}
                    </button>
                    <RadioChips
                      label={`Priority for ${stage.place.name}`}
                      className="priority-chips"
                      options={PRIORITIES}
                      value={stage.priority}
                      onChange={(priority) => updateStage.mutate({ id: stage.id, priority })}
                    />
                    {stage.pinnedTime != null && (
                      <span className="stay-place__badge">
                        <CalendarClock size={16} aria-hidden="true" />
                        Booked {formatClock(stage.pinnedTime)}
                      </span>
                    )}
                    {stay.data && (
                      <select
                        aria-label={`Move ${stage.place.name} to`}
                        value=""
                        onChange={(event) => {
                          const target = event.target.value;
                          if (target === '') return;
                          updateStage.mutate({
                            id: stage.id,
                            dayId: target === 'pool' ? null : target,
                          });
                        }}
                      >
                        <option value="">Move to…</option>
                        {stay.data.days
                          .filter((other) => other.id !== day.data.id)
                          .map((other) => (
                            <option key={other.id} value={other.id}>
                              {formatDayTitle(other.date)}
                            </option>
                          ))}
                        <option value="pool">Back to the places to fit in</option>
                      </select>
                    )}
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
