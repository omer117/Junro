import { useState } from 'react';
import { Link } from 'react-router';
import { AccountMenu } from '../account/AccountMenu';
import { PageShell } from '../layout/PageShell';
import { todayString } from '../lib/dates';
import { paletteFor } from '../styles/palettes';
import { useTripStays } from '../stay/api';
import { useTripDays, useTrips } from './api';
import { BoardingPass } from './BoardingPass';
import { DayCard } from './DayCard';
import { TripForm } from './TripForm';
import '../stay/stay.css';
import './trips.css';

/** The signed-in home: the chosen trip as a boarding pass, with its days below. */
export function TripsHome({ today = todayString() }: { today?: string }) {
  const trips = useTrips();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const list = trips.data ?? [];
  const selected = list.find((trip) => trip.id === chosenId) ?? list[0];
  const days = useTripDays(selected?.id);
  const stays = useTripStays(selected?.id);

  return (
    <PageShell className="trips-home" palette={paletteFor(selected?.destination?.countryCode)}>
      <header className="trips-home__header">
        <h1>Your trips</h1>
        <AccountMenu />
      </header>

      {trips.isPending && <p role="status">Loading your trips…</p>}

      {trips.isError && (
        <div>
          <p role="alert">Could not load your trips.</p>
          <button type="button" onClick={() => void trips.refetch()}>
            Try again
          </button>
        </div>
      )}

      {trips.isSuccess && list.length === 0 && (
        <section className="trips-home__empty">
          <h2>Plan your first trip</h2>
          <p>Give it a name, then add the days and the places you want to see.</p>
          <TripForm onDone={(trip) => setChosenId(trip.id)} />
        </section>
      )}

      {selected && (
        <>
          {list.length > 1 && (
            <div className="trips-home__switch">
              <label htmlFor="trip-select">Trip</label>
              <select
                id="trip-select"
                value={selected.id}
                onChange={(event) => setChosenId(event.target.value)}
              >
                {list.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <BoardingPass trip={selected} days={days.data ?? []} today={today} />

          {editing ? (
            <TripForm
              key={selected.id}
              trip={selected}
              onDone={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <button
              type="button"
              className="button button--outline"
              onClick={() => setEditing(true)}
            >
              Edit trip
            </button>
          )}

          <section className="trips-home__days" aria-labelledby="days-heading">
            <div className="trips-home__days-head">
              <h2 id="days-heading">Your days</h2>
              {days.data && days.data.length > 0 && (
                <span>
                  {days.data.filter((d) => d.stageCount > 0).length} of {days.data.length} days
                  planned
                </span>
              )}
            </div>

            {days.isError && <p role="alert">Could not load the days of this trip.</p>}

            {/* Days of a stay are grouped under it; the other days are listed as before. */}
            {(stays.data ?? []).map((stay) => (
              <section key={stay.id} className="stay-group" aria-label={`Stay in ${stay.name}`}>
                <div className="stay-group__head">
                  <h3>{stay.name}</h3>
                  <Link to={`/segments/${stay.id}`}>Plan this stay</Link>
                </div>
                <p className="stay-group__meta">
                  {stay.dayCount} {stay.dayCount === 1 ? 'day' : 'days'}
                  {stay.hotelName ? ` · ${stay.hotelName}` : ''}
                </p>
                <ul className="trips-home__list" aria-label={`Days in ${stay.name}`}>
                  {(days.data ?? [])
                    .filter((day) => day.segmentId === stay.id)
                    .map((day) => (
                      <li key={day.id}>
                        <DayCard day={day} />
                      </li>
                    ))}
                </ul>
              </section>
            ))}

            {days.data && (
              <ul className="trips-home__list" aria-label="Your days">
                {days.data
                  .filter((day) => !day.segmentId)
                  .map((day) => (
                    <li key={day.id}>
                      <DayCard day={day} />
                    </li>
                  ))}
              </ul>
            )}

            <div className="trips-home__add">
              <Link to={`/trips/${selected.id}/days/new`} className="button button--dark">
                Add a day
              </Link>
              <Link to={`/trips/${selected.id}/stays/new`} className="button button--outline">
                Add a stay
              </Link>
            </div>
          </section>

          <section className="trips-home__new">
            {adding ? (
              <TripForm
                onDone={(trip) => {
                  setChosenId(trip.id);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button
                type="button"
                className="button button--outline"
                onClick={() => setAdding(true)}
              >
                New trip
              </button>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
