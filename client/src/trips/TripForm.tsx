import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/api';
import { AirportPicker } from '../airports/AirportPicker';
import type { Airport } from '../airports/types';
import { useCreateTrip, useUpdateTrip } from './api';
import type { Trip } from './types';

/** Creates a trip, or (with `trip`) changes one: its name and where it starts and ends. */
export function TripForm({
  trip,
  onDone,
  onCancel,
}: {
  trip?: Trip;
  onDone: (trip: Trip) => void;
  onCancel?: () => void;
}) {
  const create = useCreateTrip();
  const update = useUpdateTrip(trip?.id ?? '');
  const [name, setName] = useState(trip?.name ?? '');
  const [origin, setOrigin] = useState<Airport | null>(trip?.origin ?? null);
  const [destination, setDestination] = useState<Airport | null>(trip?.destination ?? null);
  const [problem, setProblem] = useState<string | null>(null);

  const mutation = trip ? update : create;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem('Give your trip a name.');
      return;
    }
    setProblem(null);

    const done = {
      onSuccess: (saved: Trip) => {
        if (!trip) {
          setName('');
          setOrigin(null);
          setDestination(null);
        }
        onDone(saved);
      },
    };
    if (trip) {
      update.mutate(
        {
          name: trimmed,
          originAirport: origin?.iata ?? null,
          destinationAirport: destination?.iata ?? null,
        },
        done,
      );
    } else {
      create.mutate(
        {
          name: trimmed,
          ...(origin ? { originAirport: origin.iata } : {}),
          ...(destination ? { destinationAirport: destination.iata } : {}),
        },
        done,
      );
    }
  };

  const serverProblem =
    mutation.error instanceof ApiError && mutation.error.code === 'same_airport'
      ? mutation.error.message
      : mutation.isError
        ? 'Could not save the trip. Try again.'
        : null;
  const error = problem ?? serverProblem;

  return (
    <form className="trip-form" onSubmit={submit} noValidate>
      <label htmlFor="trip-name">Trip name</label>
      <input
        id="trip-name"
        value={name}
        maxLength={100}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        aria-invalid={error ? true : undefined}
      />
      <AirportPicker label="From" value={origin} onChange={setOrigin} />
      <AirportPicker label="To" value={destination} onChange={setDestination} />
      {error && <p role="alert">{error}</p>}
      <div className="trip-form__actions">
        <button type="submit" className="button button--accent" disabled={mutation.isPending}>
          {trip ? 'Save trip' : 'Create trip'}
        </button>
        {onCancel && (
          <button type="button" className="button button--outline" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
