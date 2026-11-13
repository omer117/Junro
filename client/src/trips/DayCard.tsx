import { Link } from 'react-router';
import { formatDayNumber, formatDayTitle, formatMonthAbbr } from '../lib/dates';
import type { Day } from './types';

/** One day of a trip. A day with no stops yet is drawn dashed, as an invitation to plan it. */
export function DayCard({ day }: { day: Day }) {
  const empty = day.stageCount === 0;
  const stops = `${day.stageCount} ${day.stageCount === 1 ? 'stop' : 'stops'}`;

  return (
    <Link to={`/days/${day.id}`} className={empty ? 'day-card day-card--empty' : 'day-card'}>
      <span className="day-card__date">
        <span>{formatMonthAbbr(day.date)}</span>
        <strong>{formatDayNumber(day.date)}</strong>
      </span>
      <span className="day-card__body">
        <span className="day-card__title">{formatDayTitle(day.date)}</span>
        <span className="day-card__meta">
          {empty ? 'Plan this day' : `${stops} · ${day.travelMode}`}
        </span>
      </span>
    </Link>
  );
}
