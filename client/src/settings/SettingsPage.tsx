import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CATEGORY_LABELS } from '../categories';
import { CategoryIcon } from '../icons/CategoryIcon';
import {
  useResetStayDuration,
  useSaveStayDuration,
  useStayDurations,
  type StayDuration,
} from './api';
import './settings.css';

const MAX_MINUTES = 1440;

/** One category: how long you like to stay there. */
function StayRow({ item }: { item: StayDuration }) {
  const label = CATEGORY_LABELS[item.category];
  const current = item.preferenceMinutes ?? item.minimumMinutes;
  const [text, setText] = useState(String(current));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveStayDuration(item.category);
  const reset = useResetStayDuration(item.category);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(text);
    if (text.trim() === '' || !Number.isInteger(minutes) || minutes > MAX_MINUTES) {
      setProblem(`Enter a whole number of minutes, up to ${MAX_MINUTES}.`);
      return;
    }
    if (minutes < item.minimumMinutes) {
      setProblem(`The shortest stay for ${label} is ${item.minimumMinutes} minutes.`);
      return;
    }
    setProblem(null);
    save.mutate(minutes);
  };

  const error = problem ?? (save.isError || reset.isError ? 'Could not save. Try again.' : null);

  return (
    <form className="stay-row" onSubmit={submit} noValidate>
      <fieldset aria-label={label}>
        <div className="stay-row__name">
          <CategoryIcon category={item.category} />
          <strong>{label}</strong>
          {item.preferenceMinutes === null && <span className="stay-row__tag">Default</span>}
        </div>
        <div className="stay-row__controls">
          <label htmlFor={`stay-${item.category}`} className="visually-hidden">
            {label} stay in minutes
          </label>
          <input
            id={`stay-${item.category}`}
            inputMode="numeric"
            type="number"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <span>min</span>
          <button
            type="submit"
            className="button button--dark"
            aria-label={`Save ${label}`}
            disabled={save.isPending}
          >
            Save
          </button>
          {item.preferenceMinutes !== null && (
            <button
              type="button"
              className="button button--outline"
              aria-label={`Reset ${label}`}
              disabled={reset.isPending}
              onClick={() => {
                setProblem(null);
                reset.mutate(undefined, { onSuccess: () => setText(String(item.minimumMinutes)) });
              }}
            >
              Reset
            </button>
          )}
        </div>
        <p className="stay-row__hint">Shortest: {item.minimumMinutes} min</p>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </form>
  );
}

/** How long you like to stay at each kind of place. Junro uses this when it plans your days. */
export function SettingsPage() {
  const durations = useStayDurations();

  return (
    <main className="settings">
      <Link to="/" className="settings__back">
        Back to your trips
      </Link>
      <h1>Stay durations</h1>
      <p className="settings__intro">
        How long do you like to stay? Junro uses this when it plans your days. You can still change
        the time for a single stop.
      </p>

      {durations.isPending && <p role="status">Loading…</p>}
      {durations.isError && (
        <div>
          <p role="alert">Could not load your stay durations.</p>
          <button type="button" onClick={() => void durations.refetch()}>
            Try again
          </button>
        </div>
      )}
      {durations.data && (
        <div className="settings__list">
          {durations.data.map((item) => (
            <StayRow key={`${item.category}-${item.preferenceMinutes ?? 'default'}`} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
