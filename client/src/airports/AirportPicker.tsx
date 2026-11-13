import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useAirportSearch, useDebouncedValue } from './api';
import type { Airport } from './types';

/**
 * Pick one airport by typing a code, a city, a country or part of a name. The choice is shown
 * as a small card with a button to remove it.
 */
export function AirportPicker({
  label,
  value,
  onChange,
  debounceMs = 250,
}: {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  debounceMs?: number;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const search = useAirportSearch(useDebouncedValue(text, debounceMs));

  if (value) {
    return (
      <div className="airport-picker">
        <span className="airport-picker__label">{label}</span>
        <div className="airport-chip">
          <strong>{value.iata}</strong>
          <span>
            {value.city}, {value.countryName}
          </span>
          <button
            type="button"
            className="airport-chip__remove"
            aria-label={`Remove ${label} airport ${value.iata}`}
            onClick={() => {
              onChange(null);
              setText('');
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="airport-picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        autoComplete="off"
        placeholder="City, airport or code"
        onChange={(event) => setText(event.target.value)}
      />
      <div aria-live="polite">
        {search.isError && <p role="alert">Could not search airports.</p>}
        {search.data && search.data.length === 0 && <p>No airports found.</p>}
        {search.data && search.data.length > 0 && (
          <ul className="airport-picker__results">
            {search.data.map((airport) => (
              <li key={airport.iata}>
                <button type="button" onClick={() => onChange(airport)}>
                  <strong>{airport.iata}</strong>
                  <span>{airport.name}</span>
                  <small>
                    {airport.city}, {airport.countryName}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
