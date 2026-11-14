import { Plane } from 'lucide-react';
import { daysUntil, formatDayTitle } from '../lib/dates';
import type { Day, Trip } from './types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The trip as a boarding pass. It shows only what is known: the name, the two airports when the
 * person has chosen them, the first planned day, the number of planned days and the countdown to
 * the first day. There are no flight times, because Junro does not hold that data.
 */
export function BoardingPass({ trip, days, today }: { trip: Trip; days: Day[]; today: string }) {
  const first = days.map((d) => d.date).sort()[0];
  const left = first === undefined ? undefined : daysUntil(first, today);

  let label = 'Takeoff in';
  let value: string | undefined;
  if (left !== undefined) {
    if (left > 0) value = plural(left, 'day');
    else if (left === 0) {
      label = 'Takeoff';
      value = 'Today';
    } else {
      label = 'Status';
      value = 'Under way';
    }
  }

  return (
    <section className="boarding-pass" aria-label="Trip boarding pass">
      <div className="boarding-pass__top">
        <span className="boarding-pass__eyebrow">Boarding pass</span>
        <span className="boarding-pass__chip">
          {days.length === 0 ? 'No days yet' : `${plural(days.length, 'day')} planned`}
        </span>
      </div>
      <h2 className="boarding-pass__name">{trip.name}</h2>
      {trip.origin && trip.destination && (
        <div
          className="boarding-pass__route"
          role="img"
          aria-label={`From ${trip.origin.city} to ${trip.destination.city}`}
        >
          <div>
            <strong>{trip.origin.iata}</strong>
            <span>{trip.origin.city}</span>
          </div>
          <div className="boarding-pass__flight" aria-hidden="true">
            <Plane className="boarding-pass__plane" size={22} />
          </div>
          <div>
            <strong>{trip.destination.iata}</strong>
            <span>{trip.destination.city}</span>
          </div>
        </div>
      )}
      <div className="boarding-pass__rule" aria-hidden="true" />
      <div className="boarding-pass__bottom">
        {first !== undefined && (
          <dl className="boarding-pass__facts">
            <div>
              <dt>Departs</dt>
              <dd>{formatDayTitle(first)}</dd>
            </div>
            {value !== undefined && (
              <div>
                <dt>{label}</dt>
                <dd className="boarding-pass__count">{value}</dd>
              </div>
            )}
          </dl>
        )}
        <span className="boarding-pass__bars" aria-hidden="true" />
      </div>
    </section>
  );
}
