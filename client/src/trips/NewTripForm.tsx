import { useState, type FormEvent } from 'react';
import type { Trip } from './types';
import { useCreateTrip } from './api';

/** Asks for a trip name and creates the trip. */
export function NewTripForm({ onCreated }: { onCreated: (trip: Trip) => void }) {
  const create = useCreateTrip();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem('Give your trip a name.');
      return;
    }
    setProblem(null);
    create.mutate(trimmed, {
      onSuccess: (trip) => {
        setName('');
        onCreated(trip);
      },
    });
  };

  const error = problem ?? (create.isError ? 'Could not create the trip. Try again.' : null);

  return (
    <form className="new-trip" onSubmit={submit} noValidate>
      <label htmlFor="trip-name">Trip name</label>
      <input
        id="trip-name"
        value={name}
        maxLength={100}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="button button--accent" disabled={create.isPending}>
        Create trip
      </button>
    </form>
  );
}
