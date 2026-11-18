import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openTodayText, stopNotes } from '../describe';
import { RouteSummary } from '../RouteSummary';
import type { RouteResult, Visit } from '../types';

const lunch = [
  { open: 690, close: 870 },
  { open: 1050, close: 1320 },
];

describe('openTodayText', () => {
  it('lists every window', () => {
    expect(openTodayText(lunch)).toBe('Open today 11:30–14:30, 17:30–22:00');
  });
  it('writes one window on its own', () => {
    expect(openTodayText([{ open: 540, close: 1020 }])).toBe('Open today 9:00–17:00');
  });
  it('shows a time past midnight on the clock', () => {
    expect(openTodayText([{ open: 1080, close: 1560 }])).toBe('Open today 18:00–2:00');
  });
  it('says nothing when there is no limit, or the place is closed (it has its own note)', () => {
    expect(openTodayText(null)).toBeNull();
    expect(openTodayText(undefined)).toBeNull();
    expect(openTodayText([])).toBeNull();
  });
});

const visit = (arrival: number, serviceStart: number, window: Visit['window']): Visit => ({
  stageId: 'a',
  arrival,
  serviceStart,
  departure: serviceStart + 60,
  waited: serviceStart - arrival,
  window,
});

describe('stopNotes with a break in the opening hours', () => {
  it('explains a wait that is the break', () => {
    const notes = stopNotes(visit(910, 1050, lunch[1]), [], lunch);

    expect(notes).toEqual([
      'Closed for a break until 17:30. You arrive at 15:10 and wait 2 h 20 min.',
    ]);
  });

  it('explains a stop moved to the later window because the stay would not fit before closing', () => {
    const notes = stopNotes(visit(840, 1050, lunch[1]), [], lunch);

    expect(notes).toEqual([
      'Not enough time before it closes at 14:30, so this is planned for when it opens again at 17:30.',
    ]);
  });

  it('keeps the plain wait note with a single window', () => {
    const one = [{ open: 1020, close: 1200 }];

    expect(stopNotes(visit(700, 1020, one[0]), [], one)).toEqual([
      'Opens at 17:00. You arrive at 11:40 and wait 5 h 20 min.',
    ]);
  });

  it('says why when the stay is longer than every opening time', () => {
    const notes = stopNotes(
      visit(600, 600, lunch[0]),
      [{ stageId: 'a', kind: 'window_too_short' }],
      lunch,
    );

    expect(notes).toContain('Each of its opening times today is shorter than your stay.');
  });
});

describe('RouteSummary opening hours', () => {
  const route: RouteResult = {
    mode: 'full',
    order: ['a'],
    visits: [visit(910, 1050, lunch[1])],
    endArrival: 1200,
    violations: [],
    totalLateness: 0,
    live: null,
    routeLine: 'line',
    openToday: { a: lunch },
  };
  const day = {
    startTime: 540,
    travelMode: 'walking' as const,
    startName: 'Hotel',
    endName: 'Hotel',
    returnsToStart: true,
  };

  it('shows when the stop is open under its name', () => {
    render(<RouteSummary route={route} day={day} stopNames={new Map([['a', 'Ramen']])} />);

    const row = within(screen.getByRole('list', { name: /timeline/i })).getAllByRole(
      'listitem',
    )[1]!;
    expect(row).toHaveTextContent('Open today 11:30–14:30, 17:30–22:00');
    expect(row).toHaveTextContent('Closed for a break until 17:30');
  });
});
