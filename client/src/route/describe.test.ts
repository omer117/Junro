import { describe, expect, it } from 'vitest';
import { formatDuration } from '../lib/duration';
import { describeRoute, stopNotes, travelMinutes } from './describe';
import type { RouteResult } from './types';

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [60, '1 h'],
    [110, '1 h 50 min'],
    [125, '2 h 5 min'],
    [59.6, '1 h'],
    [30.4, '30 min'],
  ])('writes %s minutes as "%s"', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

const visit = (stageId: string, arrival: number, departure: number, serviceStart = arrival) => ({
  stageId,
  arrival,
  serviceStart,
  departure,
  waited: serviceStart - arrival,
});

// Start 9:00. Three stops of 20 minutes each, 10 minutes of travel between, home at 11:00.
const route = (over: Partial<RouteResult> = {}): RouteResult => ({
  mode: 'full',
  order: ['a', 'b', 'c'],
  visits: [visit('a', 550, 570), visit('b', 580, 600), visit('c', 610, 630)],
  endArrival: 660,
  violations: [],
  totalLateness: 0,
  live: null,
  routeLine: 'line',
  ...over,
});

describe('travelMinutes', () => {
  it('is the time on the way, not at the stops', () => {
    // 540 to 660 is 120 minutes; 60 of them are spent at the stops.
    expect(travelMinutes(540, route())).toBe(60);
  });

  it('does not count waiting for a place to open as travel', () => {
    const waited = route({ visits: [visit('a', 550, 800, 780)], endArrival: 810 });

    // 270 minutes in all; 250 at the stop (waiting 230, staying 20); 20 on the way.
    expect(travelMinutes(540, waited)).toBe(20);
  });
});

describe('describeRoute', () => {
  const day = (over = {}) => ({
    startTime: 540,
    travelMode: 'walking' as const,
    endName: 'Hotel Gracery' as string | null,
    returnsToStart: true,
    ...over,
  });

  it('says when you are back, in plain words', () => {
    const text = describeRoute(day(), route({ endArrival: 1180 }));

    expect(text.headline).toBe('Back at Hotel Gracery by 19:40');
  });

  it('says "finish" when the day ends somewhere else', () => {
    const text = describeRoute(day({ returnsToStart: false, endName: 'Ueno Station' }), route());

    expect(text.headline).toBe('Finish at Ueno Station by 11:00');
  });

  it('copes with a day that has no names', () => {
    expect(describeRoute(day({ endName: null }), route()).headline).toBe(
      'Back at the start by 11:00',
    );
    expect(describeRoute(day({ endName: null, returnsToStart: false }), route()).headline).toBe(
      'Finish at the end by 11:00',
    );
  });

  it('says so when the day runs past midnight', () => {
    expect(describeRoute(day(), route({ endArrival: 1500 })).headline).toBe(
      'Back at Hotel Gracery by 1:00 the next day',
    );
  });

  it('adds how long you spend travelling, and that the rest is yours', () => {
    expect(describeRoute(day(), route()).detail).toBe('1 h of walking, the rest is yours');
    expect(describeRoute(day({ travelMode: 'driving' }), route({ endArrival: 650 })).detail).toBe(
      '50 min of driving, the rest is yours',
    );
  });
});

describe('stopNotes', () => {
  it('has nothing to say about a stop that is fine', () => {
    expect(stopNotes(visit('a', 550, 570), [])).toEqual([]);
  });

  it('warns when a place closes before you are done', () => {
    expect(
      stopNotes(visit('a', 550, 570), [{ stageId: 'a', kind: 'closed', minutesLate: 10 }]),
    ).toEqual(['It closes before you are done: about 10 min over.']);
  });

  it('warns about a place that is closed all day', () => {
    expect(stopNotes(visit('a', 550, 570), [{ stageId: 'a', kind: 'closed_all_day' }])).toEqual([
      'Closed on this day.',
    ]);
  });

  it('warns that a stay is longer than the opening hours', () => {
    expect(stopNotes(visit('a', 550, 570), [{ stageId: 'a', kind: 'window_too_short' }])).toEqual([
      'Its opening hours are shorter than your stay.',
    ]);
  });

  it('tells you when you arrive early and have to wait', () => {
    expect(stopNotes(visit('a', 550, 800, 780), [])).toEqual([
      'Opens at 13:00. You arrive at 9:10 and wait 3 h 50 min.',
    ]);
  });

  it('ignores a wait of a few minutes', () => {
    expect(stopNotes(visit('a', 550, 575, 553), [])).toEqual([]);
  });

  it('only counts the warnings for its own stop', () => {
    expect(stopNotes(visit('a', 550, 570), [{ stageId: 'other', kind: 'closed_all_day' }])).toEqual(
      [],
    );
  });
});
