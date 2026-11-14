import { Search } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiError } from '../api/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useCreatePlace, usePlaceSearch, type Place } from './api';

const newToken = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Math.random().toString(36).slice(2)}${Date.now()}`;

function searchProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'quota_reached') {
      return 'The monthly limit for place search has been reached. Try again next month.';
    }
    if (error.code === 'rate_limited') return 'Too many searches. Wait a moment and try again.';
    if (error.code === 'google_not_configured') return 'Place search is not available right now.';
  }
  return 'Could not search places. Try again in a moment.';
}

/**
 * Search for a place (restaurant, temple, hotel...) and choose one. Choosing saves the place on
 * the server and hands it to `onPick`. A search "session" runs from the first letter to the
 * choice and uses one token, so Google bills the search and the choice together.
 */
export function PlaceSearch({
  label,
  placeholder,
  onPick,
  near,
  debounceMs = 250,
}: {
  label: string;
  placeholder?: string;
  onPick: (place: Place) => void;
  /** Where to look first, for example where the day starts. */
  near?: { lat: number; lng: number };
  debounceMs?: number;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [token, setToken] = useState(newToken);
  const debounced = useDebouncedValue(text, debounceMs);
  // Search only once typing has settled, and never for text that is already gone (after a
  // choice the box is emptied; a late search for the old text would be a wasted call).
  const search = usePlaceSearch(debounced === text ? debounced : '', token, near);
  const create = useCreatePlace();

  const choose = (googlePlaceId: string) =>
    create.mutate(
      { googlePlaceId, sessionToken: token },
      {
        onSuccess: (place) => {
          setText('');
          setToken(newToken());
          onPick(place);
        },
      },
    );

  return (
    <div className="place-search">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <div className="place-search__box">
        <Search size={20} aria-hidden="true" />
        <input
          id={id}
          value={text}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div aria-live="polite" className="place-search__results">
        {search.isError && <p role="alert">{searchProblem(search.error)}</p>}
        {create.isError && <p role="alert">Could not add that place. Try again.</p>}
        {search.data && search.data.length === 0 && <p>No places found.</p>}
        {search.data && search.data.length > 0 && (
          <ul>
            {search.data.map((suggestion) => (
              <li key={suggestion.googlePlaceId}>
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={() => choose(suggestion.googlePlaceId)}
                >
                  {suggestion.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
