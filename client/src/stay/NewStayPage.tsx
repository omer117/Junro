import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/api';
import { minutesOf, PlaceField } from '../day/NewDayPage';
import { PageShell } from '../layout/PageShell';
import type { Place } from '../places/api';
import { useCreateStay } from './api';
import '../day/day.css';
import './stay.css';

/** Creates a stay: a few days in one city, with one hotel. The days are made for you. */
export function NewStayPage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const create = useCreateStay(tripId);

  const [name, setName] = useState('');
  const [hotel, setHotel] = useState<Place | null>(null);
  const [firstDate, setFirstDate] = useState('');
  const [dayCount, setDayCount] = useState(3);
  const [time, setTime] = useState('09:00');
  const [mode, setMode] = useState<'walking' | 'driving' | 'transit'>('walking');
  const [problems, setProblems] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: string[] = [];
    if (name.trim() === '') found.push('Give the stay a name, for example the city.');
    if (!hotel) found.push('Choose your hotel.');
    if (!firstDate) found.push('Choose the first date.');
    if (!(dayCount >= 1 && dayCount <= 10)) found.push('A stay is 1 to 10 days.');
    setProblems(found);
    if (found.length > 0 || !hotel) return;

    create.mutate(
      {
        name: name.trim(),
        firstDate,
        dayCount,
        hotel: { lat: hotel.lat, lng: hotel.lng },
        hotelName: hotel.name,
        hotelPlaceId: hotel.googlePlaceId,
        travelMode: mode,
        startTime: minutesOf(time),
      },
      { onSuccess: (stay) => navigate(`/segments/${stay.id}`) },
    );
  };

  const createProblem =
    create.error instanceof ApiError && create.error.code === 'segment_overlap'
      ? 'Another stay of this trip already uses some of these dates.'
      : create.isError
        ? 'Could not create the stay. Try again.'
        : null;

  return (
    <PageShell className="new-day">
      <Link to="/" className="new-day__back">
        Back to your trips
      </Link>
      <h1>Add a stay</h1>
      <p>
        A stay is a few days in one city. Collect the places you want to see, and Junro suggests
        which day each one fits.
      </p>
      <form onSubmit={submit} noValidate className="new-day__form">
        <label htmlFor="stay-name">City or name</label>
        <input
          id="stay-name"
          value={name}
          maxLength={100}
          placeholder="Tokyo"
          onChange={(e) => setName(e.target.value)}
        />

        <PlaceField
          question="Where are you staying?"
          changeLabel="Change hotel"
          place={hotel}
          onChange={setHotel}
        />

        <label htmlFor="stay-first">First day</label>
        <input
          id="stay-first"
          type="date"
          value={firstDate}
          onChange={(e) => setFirstDate(e.target.value)}
        />

        <label htmlFor="stay-days">Number of days</label>
        <input
          id="stay-days"
          type="number"
          min={1}
          max={10}
          value={dayCount}
          onChange={(e) => setDayCount(Number(e.target.value))}
        />

        <label htmlFor="stay-time">Start time each day</label>
        <input id="stay-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

        <fieldset className="new-day__mode">
          <legend>Travel mode</legend>
          {(['walking', 'driving', 'transit'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {value === 'walking' ? 'Walking' : value === 'driving' ? 'Driving' : 'Transit'}
            </label>
          ))}
        </fieldset>

        {problems.map((problem) => (
          <p key={problem} role="alert">
            {problem}
          </p>
        ))}
        {createProblem && <p role="alert">{createProblem}</p>}

        <button type="submit" className="button button--accent" disabled={create.isPending}>
          Create stay
        </button>
      </form>
    </PageShell>
  );
}
