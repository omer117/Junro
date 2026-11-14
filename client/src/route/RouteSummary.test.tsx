import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteSummary } from './RouteSummary';
import type { RouteResult } from './types';

const route: RouteResult = {
  mode: 'full',
  order: ['a', 'b'],
  visits: [
    { stageId: 'a', arrival: 560, serviceStart: 560, departure: 600, waited: 0 },
    { stageId: 'b', arrival: 700, serviceStart: 1020, departure: 1050, waited: 320 },
  ],
  endArrival: 1180,
  violations: [{ stageId: 'a', kind: 'closed', minutesLate: 15 }],
  totalLateness: 15,
  live: null,
  routeLine: 'line',
};

const day = {
  startTime: 540,
  travelMode: 'walking' as const,
  startName: 'Hotel Gracery' as string | null,
  endName: 'Hotel Gracery' as string | null,
  returnsToStart: true,
};

const names = new Map([
  ['a', 'Kappabashi street'],
  ['b', 'Hoppy street bar'],
]);

describe('RouteSummary', () => {
  it('leads with when you are back, then how much of the day is travel', () => {
    render(<RouteSummary route={route} day={day} stopNames={names} />);

    expect(
      screen.getByRole('heading', { name: 'Back at Hotel Gracery by 19:40' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/of walking, the rest is yours/)).toBeInTheDocument();
  });

  it('lists the day as a timeline: start, every stop in order with its time, and the end', () => {
    render(<RouteSummary route={route} day={day} stopNames={names} />);

    const timeline = screen.getByRole('list', { name: /timeline/i });
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Hotel Gracery');
    expect(rows[0]).toHaveTextContent('9:00');
    expect(rows[1]).toHaveTextContent('Kappabashi street');
    expect(rows[1]).toHaveTextContent('9:20');
    expect(rows[2]).toHaveTextContent('Hoppy street bar');
    expect(rows[2]).toHaveTextContent('11:40');
    expect(rows[3]).toHaveTextContent('Hotel Gracery');
    expect(rows[3]).toHaveTextContent('19:40');
  });

  it('puts each warning under its stop, as an icon and words', () => {
    render(<RouteSummary route={route} day={day} stopNames={names} />);

    const rows = within(screen.getByRole('list', { name: /timeline/i })).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('It closes before you are done: about 15 min over.');
    expect(rows[1]!.querySelector('svg')).not.toBeNull();
    expect(rows[2]).toHaveTextContent('Opens at 17:00. You arrive at 11:40 and wait 5 h 20 min.');
    expect(within(rows[0]!).queryByText(/closes/i)).toBeNull();
  });

  it('names the end of a day that finishes somewhere else', () => {
    render(
      <RouteSummary
        route={route}
        day={{ ...day, returnsToStart: false, endName: 'Ueno Station' }}
        stopNames={names}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Finish at Ueno Station by 19:40' }),
    ).toBeInTheDocument();
  });

  it('says plainly when only the line could not be drawn', () => {
    render(
      <RouteSummary
        route={{ ...route, routeLine: null, routeLineError: 'google_unavailable' }}
        day={day}
        stopNames={names}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/line could not be drawn/i);
  });
});
