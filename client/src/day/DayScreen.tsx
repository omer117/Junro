import { ChevronLeft, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/api';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import { formatClock, formatDayTitle } from '../lib/dates';
import type { MapMarker } from '../map/engine';
import { MapView } from '../map/MapView';
import type { Place } from '../places/api';
import { PlaceSearch } from '../places/PlaceSearch';
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

/** One day: the map with its stops, and a sheet to plan it. */
export function DayScreen() {
  const { dayId } = useParams();
  const day = useDay(dayId);
  const stagesQuery = useStages(dayId);
  const addStage = useAddStage(dayId ?? '');
  const updateStage = useUpdateStage(dayId ?? '');
  const deleteStage = useDeleteStage(dayId ?? '');
  const updateDay = useUpdateDay(dayId ?? '');
  const [pending, setPending] = useState<Place | null>(null);

  const stages = useMemo(() => inRouteOrder(stagesQuery.data ?? []), [stagesQuery.data]);
  // Numbers on the map mean a route exists: every stop has a place in it.
  const hasRoute = stages.length > 0 && stages.every((stage) => stage.position !== null);

  const markers = useMemo<MapMarker[]>(() => {
    if (!day.data) return [];
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
      })),
      {
        id: 'end',
        kind: 'end',
        position: day.data.end,
        label: `End · ${day.data.endName ?? 'end'}`,
      },
    ];
  }, [day.data, stages, hasRoute]);

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

  const addProblem =
    addStage.error instanceof ApiError && addStage.error.code === 'day_full'
      ? 'A day can have at most 15 stops.'
      : addStage.isError
        ? 'Could not add the stop. Try again.'
        : null;

  return (
    <div className="day-screen">
      <MapView markers={markers} padding={MAP_PADDING} />

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

        {addProblem && <p role="alert">{addProblem}</p>}

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
                    updateStage.mutate({ id: stage.id, category: event.target.value as Category })
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
      </section>
    </div>
  );
}
