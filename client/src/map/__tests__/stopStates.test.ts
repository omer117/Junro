import { describe, expect, it } from 'vitest';
import type { RouteResult } from '../../route/types';
import { stopStates } from '../stopStates';

const visit = (stageId: string, waited = 0) => ({
  stageId,
  arrival: 560,
  serviceStart: 560 + waited,
  departure: 600 + waited,
  waited,
});

const route = (overrides: Partial<RouteResult> = {}): RouteResult => ({
  mode: 'saved',
  order: ['a', 'b', 'c'],
  visits: [visit('a'), visit('b'), visit('c')],
  endArrival: 900,
  violations: [],
  totalLateness: 0,
  live: null,
  routeLine: null,
  ...overrides,
});

const stage = (id: string, extra: { done?: boolean; dropped?: boolean } = {}) => ({
  id,
  done: false,
  dropped: false,
  ...extra,
});
const stages = [stage('a'), stage('b'), stage('c')];

describe('stopStates', () => {
  it('is "upcoming" for a stop in the route that has nothing special about it', () => {
    const states = stopStates(stages, route(), { today: false });

    expect([...states.values()]).toEqual(['upcoming', 'upcoming', 'upcoming']);
  });

  it('marks the first stop that is not done as "next" when the day is today', () => {
    const states = stopStates([stage('a', { done: true }), stage('b'), stage('c')], route(), {
      today: true,
    });

    expect(states.get('a')).toBe('done');
    expect(states.get('b')).toBe('next');
    expect(states.get('c')).toBe('upcoming');
  });

  it('has no "next" on a day that is not today, or without a route', () => {
    expect(stopStates(stages, route(), { today: false }).get('a')).toBe('upcoming');
    expect(stopStates(stages, null, { today: true }).get('a')).toBe('upcoming');
  });

  it('marks done stops as done', () => {
    expect(stopStates([stage('a', { done: true })], null, { today: false }).get('a')).toBe('done');
  });

  it.each([
    [{ stageId: 'b', kind: 'closed', minutesLate: 10 } as const],
    [{ stageId: 'b', kind: 'window_too_short' } as const],
    [{ stageId: 'b', kind: 'closed_all_day' } as const],
  ])('marks a stop with the problem %j as "late"', (violation) => {
    const states = stopStates(stages, route({ violations: [violation] }), { today: false });

    expect(states.get('b')).toBe('late');
    expect(states.get('a')).toBe('upcoming');
  });

  it('does not treat a day-level overtime as a problem of one stop', () => {
    const states = stopStates(
      stages,
      route({ violations: [{ kind: 'past_day_end', minutesLate: 30 }] }),
      { today: false },
    );

    expect([...states.values()]).toEqual(['upcoming', 'upcoming', 'upcoming']);
  });

  it('marks a wait of 5 minutes or more as "waiting", a shorter one as nothing', () => {
    const states = stopStates(
      stages,
      route({ visits: [visit('a', 4), visit('b', 5), visit('c', 90)] }),
      { today: false },
    );

    expect(states.get('a')).toBe('upcoming');
    expect(states.get('b')).toBe('waiting');
    expect(states.get('c')).toBe('waiting');
  });

  it('lets "late" win over "waiting" (a real problem is never shown as a wait)', () => {
    const states = stopStates(
      stages,
      route({
        visits: [visit('a'), visit('b', 60), visit('c')],
        violations: [{ stageId: 'b', kind: 'closed', minutesLate: 5 }],
      }),
      { today: false },
    );

    expect(states.get('b')).toBe('late');
  });

  it('lets "late" win over "next", and "next" over "waiting"', () => {
    const lateFirst = stopStates(
      stages,
      route({ violations: [{ stageId: 'a', kind: 'closed', minutesLate: 5 }] }),
      { today: true },
    );
    const waitingFirst = stopStates(
      stages,
      route({ visits: [visit('a', 30), visit('b'), visit('c')] }),
      {
        today: true,
      },
    );

    expect(lateFirst.get('a')).toBe('late');
    expect(waitingFirst.get('a')).toBe('next');
  });

  it('marks stops that were left out as "dropped", from the stage or from the route', () => {
    const states = stopStates(
      [stage('a', { dropped: true }), stage('b'), stage('c')],
      route({ dropped: ['c'] }),
      { today: false },
    );

    expect(states.get('a')).toBe('dropped');
    expect(states.get('c')).toBe('dropped');
    expect(states.get('b')).toBe('upcoming');
  });

  it('skips dropped and done stops when looking for the next one', () => {
    const states = stopStates(
      [stage('a', { dropped: true }), stage('b', { done: true }), stage('c')],
      route(),
      { today: true },
    );

    expect(states.get('c')).toBe('next');
  });
});
