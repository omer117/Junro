import { useMemo, useState } from 'react';
import { formatDuration } from '../lib/duration';
import { RadioChips } from '../lib/RadioChips';
import { useLegOptions } from './api';
import type { TransitOption, TransitStep } from './types';

type Preference = 'fastest' | 'least-walking' | 'fewest-changes';

const PREFERENCES: Array<{ value: Preference; label: string }> = [
  { value: 'fastest', label: 'Fastest' },
  { value: 'least-walking', label: 'Least walking' },
  { value: 'fewest-changes', label: 'Fewest changes' },
];

/** Options in the order the person prefers; ties go to the quicker one. */
export function sortOptions(options: TransitOption[], preference: Preference): TransitOption[] {
  const key = (o: TransitOption): number =>
    preference === 'least-walking'
      ? o.walkMinutes
      : preference === 'fewest-changes'
        ? o.transfers
        : 0;
  return [...options].sort((a, b) => key(a) - key(b) || a.minutes - b.minutes);
}

const changes = (n: number) => (n === 0 ? 'No changes' : `${n} ${n === 1 ? 'change' : 'changes'}`);

/** One step in words: "Walk 3 min", "Ginza Line 16 min, 8 stops toward Asakusa". */
function describeStep(step: TransitStep): string {
  if (step.kind === 'walk') return `Walk ${formatDuration(step.minutes)}`;
  const parts = [`${step.line ?? 'Transit'} ${formatDuration(step.minutes)}`];
  if (step.stops !== undefined) parts.push(`${step.stops} ${step.stops === 1 ? 'stop' : 'stops'}`);
  const text = parts.join(', ');
  return step.headsign ? `${text} toward ${step.headsign}` : text;
}

/**
 * "Other ways" for one leg of a public transport day: a button that opens the options Google
 * found, with a choice of how to order them. They are asked for only when opened.
 */
export function LegWays({
  dayId,
  index,
  at,
  from,
  to,
}: {
  dayId: string;
  index: number;
  /** When the leg starts, in minutes since midnight. */
  at: number;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const [preference, setPreference] = useState<Preference>('fastest');
  const query = useLegOptions(dayId, index, at, open);
  const sorted = useMemo(() => sortOptions(query.data ?? [], preference), [query.data, preference]);

  return (
    <div className="leg-ways">
      <button
        type="button"
        className="leg-ways__toggle"
        aria-expanded={open}
        aria-label={`Other ways from ${from} to ${to}`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide other ways' : 'Other ways'}
      </button>

      {open && (
        <div className="leg-ways__panel">
          {query.isPending && <p role="status">Looking for ways…</p>}
          {query.isError && (
            <p role="alert">Could not find other ways right now. Try again in a moment.</p>
          )}
          {query.data && query.data.length === 0 && <p>No other ways found for this leg.</p>}
          {sorted.length > 0 && (
            <>
              <RadioChips
                label="Order by"
                options={PREFERENCES}
                value={preference}
                onChange={setPreference}
                className="leg-ways__order"
              />
              <ol aria-label="Ways to get there" className="leg-ways__list">
                {sorted.map((option, i) => (
                  <li key={i}>
                    <strong>{formatDuration(option.minutes)}</strong>
                    <span>
                      {changes(option.transfers)}
                      {option.walkMinutes > 0 ? `, ${option.walkMinutes} min walking` : ''}
                    </span>
                    <span className="leg-ways__steps">
                      {option.steps.map(describeStep).join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
