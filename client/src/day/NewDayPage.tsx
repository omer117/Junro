import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageShell } from '../layout/PageShell';
import type { Place } from '../places/api';
import { PlaceSearch } from '../places/PlaceSearch';
import type { TravelMode } from '../trips/types';
import { useCreateDay } from './api';
import './day.css';

/** "09:30" as minutes since midnight. */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** A place that has been chosen, with a way to choose another. Otherwise the search. */
function PlaceField({
  question,
  changeLabel,
  place,
  onChange,
}: {
  question: string;
  changeLabel: string;
  place: Place | null;
  onChange: (place: Place | null) => void;
}) {
  if (place) {
    return (
      <div className="place-field">
        <span className="place-field__question">{question}</span>
        <div className="place-field__chosen">
          <strong>{place.name}</strong>
          <button type="button" className="button button--outline" onClick={() => onChange(null)}>
            {changeLabel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="place-field">
      {/* The question shows above the box; screen readers get it as the box's own label. */}
      <span className="place-field__question" aria-hidden="true">
        {question}
      </span>
      <PlaceSearch label={question} placeholder="Hotel, station, address…" onPick={onChange} />
    </div>
  );
}

/** Creates a day of a trip: when, where it starts and ends, from what time, and how you travel. */
export function NewDayPage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const create = useCreateDay(tripId);

  const [date, setDate] = useState('');
  const [start, setStart] = useState<Place | null>(null);
  const [end, setEnd] = useState<Place | null>(null);
  const [sameEnd, setSameEnd] = useState(true);
  const [time, setTime] = useState('09:00');
  const [mode, setMode] = useState<TravelMode>('walking');
  const [problems, setProblems] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: string[] = [];
    if (!date) found.push('Choose a date.');
    if (!start) found.push('Choose where the day starts.');
    if (!sameEnd && !end) found.push('Choose where the day ends.');
    setProblems(found);
    if (found.length > 0 || !start) return;

    const finish = sameEnd ? start : end!;
    create.mutate(
      {
        date,
        start: { lat: start.lat, lng: start.lng },
        end: { lat: finish.lat, lng: finish.lng },
        startName: start.name,
        endName: finish.name,
        startTime: minutesOf(time),
        travelMode: mode,
      },
      { onSuccess: (day) => navigate(`/days/${day.id}`) },
    );
  };

  return (
    <PageShell className="new-day">
      <Link to="/" className="new-day__back">
        Back to your trips
      </Link>
      <h1>Add a day</h1>
      <form onSubmit={submit} noValidate className="new-day__form">
        <label htmlFor="day-date">Date</label>
        <input id="day-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <PlaceField
          question="Where does the day start?"
          changeLabel="Change start"
          place={start}
          onChange={setStart}
        />

        <div className="new-day__same">
          <input
            id="same-end"
            type="checkbox"
            checked={sameEnd}
            onChange={(e) => setSameEnd(e.target.checked)}
          />
          <label htmlFor="same-end">Ends where it starts</label>
        </div>

        {!sameEnd && (
          <PlaceField
            question="Where does the day end?"
            changeLabel="Change end"
            place={end}
            onChange={setEnd}
          />
        )}

        <label htmlFor="day-time">Start time</label>
        <input id="day-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />

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
        {create.isError && <p role="alert">Could not create the day. Try again.</p>}

        <button type="submit" className="button button--accent" disabled={create.isPending}>
          Create day
        </button>
      </form>
    </PageShell>
  );
}
