import { CalendarClock, ChevronLeft, Shuffle, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/api';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '../categories';
import { DayCard } from '../trips/DayCard';
import type { Stage } from '../day/types';
import { CategoryIcon } from '../icons/CategoryIcon';
import { formatClock, formatDayTitle } from '../lib/dates';
import { RadioChips } from '../lib/RadioChips';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { MapMarker } from '../map/engine';
import { MapView } from '../map/MapView';
import type { Place } from '../places/api';
import { PlaceSearch } from '../places/PlaceSearch';
import {
  useAcceptSplit,
  useAddPoolPlace,
  useChangePlace,
  useRemovePlace,
  useSplit,
  useStay,
  useStayPlaces,
} from './api';
import { ProposalReview } from './ProposalReview';
import type { Proposal } from './types';
import '../day/day.css';
import './stay.css';

const WIDE_SCREEN = '(min-width: 52rem)';
const PHONE_PADDING = { top: 110, right: 32, bottom: 400, left: 32 };
const COMPUTER_PADDING = { top: 110, right: 48, bottom: 48, left: 480 };

const PRIORITIES: Array<{ value: 'must' | 'optional'; label: string }> = [
  { value: 'must', label: 'Must' },
  { value: 'optional', label: 'If time' },
];

function timeOf(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function splitProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'nothing_to_split') return 'Add some places to the stay first.';
    if (error.code === 'no_days_to_split') return 'Every day of this stay is already under way.';
    if (error.code === 'rate_limited') return 'Too many splits. Wait a moment and try again.';
  }
  return 'Could not split the stay. Try again.';
}

/** A stay: the places to fit in, and Junro's suggestion of which day each one goes on. */
export function StayScreen() {
  const { stayId } = useParams();
  const stay = useStay(stayId);
  const placesQuery = useStayPlaces(stayId);
  const addPlace = useAddPoolPlace(stayId ?? '');
  const changePlace = useChangePlace(stayId ?? '');
  const removePlace = useRemovePlace(stayId ?? '');
  const split = useSplit(stayId ?? '');
  const accept = useAcceptSplit(stayId ?? '');
  const wide = useMediaQuery(WIDE_SCREEN);

  const [pending, setPending] = useState<Place | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [bookDay, setBookDay] = useState<string>('');
  const [bookTime, setBookTime] = useState('19:00');
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const all = useMemo(() => placesQuery.data ?? [], [placesQuery.data]);
  const pool = all.filter((place) => place.dayId === null);
  const onDays = all.filter((place) => place.dayId !== null);
  const days = useMemo(() => stay.data?.days ?? [], [stay.data]);
  const names = useMemo(() => new Map(all.map((p) => [p.id, p.place.name])), [all]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!stay.data) return [];
    const proposedDay = new Map<string, number>();
    proposal?.days.forEach((d, index) => d.order.forEach((id) => proposedDay.set(id, index + 1)));
    const dayNumber = new Map(days.map((d, index) => [d.id, index + 1]));
    const flagged = new Set<string>();
    for (const d of proposal?.days ?? []) {
      for (const violation of d.violations)
        if ('stageId' in violation) flagged.add(violation.stageId);
    }
    return [
      {
        id: 'start',
        kind: 'start',
        position: stay.data.hotel,
        label: stay.data.hotelName ?? 'Hotel',
      },
      ...all.map((place): MapMarker => {
        const number = proposal
          ? proposedDay.get(place.id)
          : place.dayId
            ? dayNumber.get(place.dayId)
            : undefined;
        return {
          id: place.id,
          kind: 'stage',
          position: { lat: place.place.lat, lng: place.place.lng },
          name: place.place.name,
          category: place.category,
          ...(number !== undefined ? { number } : {}),
          ...(flagged.has(place.id) ? { warning: true } : {}),
        };
      }),
    ];
  }, [stay.data, all, days, proposal]);

  if (stay.isPending) return <p role="status">Loading the stay…</p>;
  if (stay.isError || !stay.data) {
    return (
      <main className="day-error">
        <p role="alert">Could not find this stay.</p>
        <Link to="/" className="button button--dark">
          Back to your trips
        </Link>
      </main>
    );
  }

  const chooseCategory = (category: Category) => {
    if (!pending) return;
    addPlace.mutate({ placeId: pending.id, category }, { onSuccess: () => setPending(null) });
  };

  const startBooking = (place: Stage) => {
    setBooking(place.id);
    setBookDay(place.dayId ?? days[0]?.id ?? '');
    setBookTime(place.pinnedTime != null ? timeOf(place.pinnedTime) : '19:00');
  };

  const saveBooking = (place: Stage) => {
    changePlace.mutate(
      { id: place.id, dayId: bookDay, pinnedTime: minutesOf(bookTime) },
      { onSuccess: () => setBooking(null) },
    );
    setProposal(null);
  };

  const dayTitle = (dayId: string | null) => {
    const day = days.find((d) => d.id === dayId);
    return day ? formatDayTitle(day.date) : '';
  };

  const addProblem =
    addPlace.error instanceof ApiError && addPlace.error.code === 'stay_full'
      ? 'This stay is full. Remove a place to add another.'
      : addPlace.isError
        ? 'Could not add the place. Try again.'
        : null;

  const row = (place: Stage) => (
    <li key={place.id}>
      <div className="stay-place__main">
        <CategoryIcon category={place.category} />
        <span className="stop-list__name">{place.place.name}</span>
        <button
          type="button"
          className="stop-list__remove"
          aria-label={`Remove ${place.place.name}`}
          onClick={() => {
            setProposal(null);
            removePlace.mutate(place.id);
          }}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="stay-place__options">
        <RadioChips
          label={`Priority for ${place.place.name}`}
          className="priority-chips"
          options={PRIORITIES}
          value={place.priority}
          disabled={place.pinnedTime != null}
          onChange={(priority) => {
            setProposal(null);
            changePlace.mutate({ id: place.id, priority });
          }}
        />
        {place.pinnedTime != null ? (
          <span className="stay-place__badge">
            <CalendarClock size={16} aria-hidden="true" />
            Booked {formatClock(place.pinnedTime)}
            {place.dayId ? ` · ${dayTitle(place.dayId)}` : ''}
          </span>
        ) : null}
        <button
          type="button"
          className="button button--outline"
          aria-label={`${place.pinnedTime != null ? 'Change booking' : 'Book a time'} for ${place.place.name}`}
          onClick={() => (booking === place.id ? setBooking(null) : startBooking(place))}
        >
          {place.pinnedTime != null ? 'Change booking' : 'Book a time'}
        </button>
        {place.pinnedTime != null && (
          <button
            type="button"
            className="button button--outline"
            aria-label={`Remove the booking for ${place.place.name}`}
            onClick={() => {
              setProposal(null);
              changePlace.mutate({ id: place.id, pinnedTime: null });
            }}
          >
            Remove booking
          </button>
        )}
      </div>
      {booking === place.id && (
        <div className="stay-place__book" role="group" aria-label={`Book ${place.place.name}`}>
          <RadioChips
            label="Day"
            options={days.map((d) => ({ value: d.id, label: formatDayTitle(d.date) }))}
            value={bookDay}
            onChange={setBookDay}
          />
          <label htmlFor={`book-time-${place.id}`}>Time</label>
          <input
            id={`book-time-${place.id}`}
            type="time"
            value={bookTime}
            onChange={(event) => setBookTime(event.target.value)}
          />
          {changePlace.isError && (
            <p role="alert">
              That time is outside the day. Choose a time between its start and end.
            </p>
          )}
          <button
            type="button"
            className="button button--accent"
            disabled={changePlace.isPending || bookTime === '' || bookDay === ''}
            onClick={() => saveBooking(place)}
          >
            Save booking
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="day-screen" data-layout={wide ? 'wide' : 'narrow'}>
      <MapView markers={markers} padding={wide ? COMPUTER_PADDING : PHONE_PADDING} />

      <div className="day-screen__top">
        <Link to="/" className="day-screen__back" aria-label="Back to your trips">
          <ChevronLeft size={24} aria-hidden="true" />
        </Link>
        <PlaceSearch
          label="Add a place"
          placeholder="Add a place"
          near={stay.data.hotel}
          onPick={(place) => {
            addPlace.reset();
            setPending(place);
          }}
        />
      </div>

      <section className="day-sheet" aria-label={`Plan your stay in ${stay.data.name}`}>
        <div className="day-sheet__handle" aria-hidden="true" />

        <div className="day-sheet__head">
          <h1>{stay.data.name}</h1>
          <span>
            {stay.data.dayCount} {stay.data.dayCount === 1 ? 'day' : 'days'} · {all.length}{' '}
            {all.length === 1 ? 'place' : 'places'}
          </span>
        </div>

        {pending && (
          <section className="category-chooser" aria-labelledby="stay-kind-heading">
            <h2 id="stay-kind-heading">What kind of place is {pending.name}?</h2>
            <div className="category-chooser__options">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  disabled={addPlace.isPending}
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

        {proposal ? (
          <ProposalReview
            proposal={proposal}
            days={days}
            stayName={stay.data.name}
            names={names}
            busy={accept.isPending}
            onAccept={() => accept.mutate(proposal, { onSuccess: () => setProposal(null) })}
            onBack={() => setProposal(null)}
          />
        ) : (
          <>
            <section aria-labelledby="pool-heading">
              <h2 id="pool-heading">Places to fit in</h2>
              {pool.length === 0 ? (
                <p className="day-sheet__empty">
                  {all.length === 0
                    ? 'No places yet. Search above to add the first one.'
                    : 'Every place is on a day.'}
                </p>
              ) : (
                <ul aria-label="Places to fit in" className="stop-list stay-places">
                  {pool.map(row)}
                </ul>
              )}
            </section>

            {onDays.length > 0 && (
              <section aria-labelledby="on-days-heading">
                <h2 id="on-days-heading">Already on a day</h2>
                <ul aria-label="Places on a day" className="stop-list stay-places">
                  {onDays.map(row)}
                </ul>
              </section>
            )}

            {accept.isError && (
              <p role="alert">
                {accept.error instanceof ApiError && accept.error.code === 'stale_proposal'
                  ? 'Your places changed while you were looking. Split again.'
                  : 'Could not save the plan. Try again.'}
              </p>
            )}
            {split.isError && <p role="alert">{splitProblem(split.error)}</p>}

            <button
              type="button"
              className="button button--accent button--wide"
              disabled={all.length === 0 || split.isPending}
              aria-busy={split.isPending}
              onClick={() => split.mutate(undefined, { onSuccess: setProposal })}
            >
              <Shuffle size={20} aria-hidden="true" />
              {split.isPending ? 'Splitting into days…' : 'Split into days'}
            </button>
            {all.length === 0 && <p className="day-sheet__hint">Add places to split them.</p>}

            <section aria-labelledby="stay-days-heading">
              <h2 id="stay-days-heading">Days</h2>
              <ul className="trips-home__list" aria-label="Days of this stay">
                {days.map((day) => (
                  <li key={day.id}>
                    <DayCard day={day} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </section>
    </div>
  );
}
