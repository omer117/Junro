import { CircleAlert } from 'lucide-react';
import { formatClock, formatDayTitle } from '../lib/dates';
import { formatDuration } from '../lib/duration';
import { stopNotes } from '../route/describe';
import type { DayDetail } from '../day/types';
import type { Proposal } from './types';

const REASONS = {
  closed_all_days: (stay: string) => `Closed on all your ${stay} days.`,
  did_not_fit: () => 'No time left on any day.',
} as const;

/**
 * The proposed split, one card per day, before anything is saved. Times are guesses from
 * distances (marked as an estimate); the real ones come when a day is planned.
 */
export function ProposalReview({
  proposal,
  days,
  stayName,
  names,
  busy,
  onAccept,
  onBack,
}: {
  proposal: Proposal;
  days: DayDetail[];
  stayName: string;
  /** Stage id to place name. */
  names: Map<string, string>;
  busy: boolean;
  onAccept: () => void;
  onBack: () => void;
}) {
  const dayById = new Map(days.map((day) => [day.id, day]));
  const movedFrom = new Map(proposal.moved.map((m) => [m.stageId, m.fromDayId]));

  return (
    <section className="proposal" aria-labelledby="proposal-heading">
      <h2 id="proposal-heading">Your plan for {stayName}</h2>
      <p className="proposal__estimate">
        Times are estimates from distances. Exact times appear when you plan each day.
      </p>

      {proposal.days.map((planned) => {
        const day = dayById.get(planned.dayId);
        if (!day) return null;
        const atPlaces = planned.visits.reduce((sum, v) => sum + (v.departure - v.arrival), 0);
        const total = planned.endArrival - day.startTime;
        const pastEnd = planned.violations.find((v) => v.kind === 'past_day_end');
        return (
          <article
            key={planned.dayId}
            className="proposal__day"
            aria-label={formatDayTitle(day.date)}
          >
            <h3>{formatDayTitle(day.date)}</h3>
            {planned.order.length === 0 ? (
              <p className="proposal__empty">Nothing planned for this day.</p>
            ) : (
              <>
                <p className="proposal__summary">
                  About {formatDuration(total)}, {formatDuration(total - atPlaces)} of travel
                  (estimate)
                </p>
                <ol className="proposal__places">
                  {planned.visits.map((visit) => {
                    const from = movedFrom.get(visit.stageId);
                    const fromDay = from ? dayById.get(from) : undefined;
                    const notes = stopNotes(visit, planned.violations);
                    return (
                      <li key={visit.stageId}>
                        <span className="proposal__name">
                          {names.get(visit.stageId) ?? 'Place'}
                        </span>
                        <span className="proposal__time">{formatClock(visit.arrival)}</span>
                        {fromDay && (
                          <span className="proposal__moved">
                            Moved from {formatDayTitle(fromDay.date).split(',')[0]}
                          </span>
                        )}
                        {notes.map((note) => (
                          <p key={note} className="proposal__warning">
                            <CircleAlert size={16} aria-hidden="true" />
                            {note}
                          </p>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {pastEnd && pastEnd.kind === 'past_day_end' && (
              <p className="proposal__warning">
                <CircleAlert size={16} aria-hidden="true" />
                This day runs {formatDuration(pastEnd.minutesLate)} past the time you wanted it to
                end.
              </p>
            )}
          </article>
        );
      })}

      {proposal.leftOut.length > 0 && (
        <section className="proposal__left-out" aria-labelledby="left-out-heading">
          <h3 id="left-out-heading">Didn&apos;t fit</h3>
          <ul>
            {proposal.leftOut.map((item) => (
              <li key={item.id}>
                <strong>{names.get(item.id) ?? 'Place'}</strong>
                <span>{REASONS[item.reason](stayName)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="proposal__actions">
        <button
          type="button"
          className="button button--accent"
          disabled={busy}
          aria-busy={busy}
          onClick={onAccept}
        >
          Use this plan
        </button>
        <button type="button" className="button button--outline" onClick={onBack}>
          Back to editing
        </button>
      </div>
    </section>
  );
}
