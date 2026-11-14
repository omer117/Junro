import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../map/fakeEngine';
import { MapEngineProvider } from '../map/MapEngineContext';
import type { MapMarker } from '../map/engine';
import type { RouteResult } from '../route/types';
import { DayScreen } from './DayScreen';
import type { DayDetail, Stage } from './types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const day: DayDetail = {
  id: 'd1',
  tripId: 't1',
  date: '2027-04-01',
  start: { lat: 35.68, lng: 139.76 },
  end: { lat: 35.68, lng: 139.76 },
  startName: 'Hotel',
  endName: 'Hotel',
  startTime: 540,
  travelMode: 'walking',
  stageCount: 3,
};

const stage = (id: string, name: string, position: number, done = false): Stage => ({
  id,
  dayId: 'd1',
  category: 'temple',
  stayOverrideMinutes: null,
  done,
  position,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 },
});

const route = (overrides: Partial<RouteResult> = {}): RouteResult => ({
  mode: 'saved',
  order: ['s2', 's3'],
  visits: [
    { stageId: 's2', arrival: 700, serviceStart: 700, departure: 740, waited: 0 },
    { stageId: 's3', arrival: 780, serviceStart: 780, departure: 820, waited: 0 },
  ],
  endArrival: 860,
  violations: [],
  totalLateness: 0,
  live: null,
  routeLine: 'LINE',
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup(saved: RouteResult = route(), today = new Date(2027, 3, 1, 10, 30)) {
  // The day is dated 2027-04-01. Only the clock is faked, so timers and promises run normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(today);
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const stages = [
    stage('s1', 'Senso-ji', 0, true),
    stage('s2', 'Ueno ramen', 1),
    stage('s3', 'Shibuya Station', 2),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, day);
      if (url === '/api/days/d1/stages' && method === 'GET') return json(200, stages);
      if (url === '/api/days/d1/route') return json(200, saved);
      if (url === '/api/days/d1/solve' && method === 'POST') {
        return json(200, { ...saved, mode: 'full', live: { lat: 35.7, lng: 139.8, time: 630 } });
      }
      if (url.startsWith('/api/stages/') && method === 'PATCH') return json(200, stages[0]);
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const fake = fakeEngine();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MapEngineProvider loader={async () => fake.engine}>
        <MemoryRouter initialEntries={['/days/d1']}>
          <Routes>
            <Route path="/days/:dayId" element={<DayScreen />} />
          </Routes>
        </MemoryRouter>
      </MapEngineProvider>
    </QueryClientProvider>,
  );
  const lastMarkers = () =>
    (fake.created[0]?.map.setMarkers.mock.calls.at(-1)?.[0] ?? []) as MapMarker[];
  return { requests, lastMarkers };
}

const stubPosition = (behaviour: (ok: PositionCallback, fail: PositionErrorCallback) => void) =>
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: behaviour } });

describe('a day in progress', () => {
  it('marks a stop as done with one press, and a done stop can be undone', async () => {
    const { requests } = setup();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark Ueno ramen as done' }));

    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/stages/s2')?.body).toEqual({ done: true }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo done for Senso-ji' }));
    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/stages/s1')?.body).toEqual({ done: false }),
    );
  });

  it('shows done stops in the timeline as done, and the rest still to come', async () => {
    setup();

    const timeline = await screen.findByRole('list', { name: 'Timeline' });

    expect(within(timeline).getByText('Senso-ji').closest('li')).toHaveTextContent(/done/i);
    expect(within(timeline).getByText('Ueno ramen')).toBeInTheDocument();
  });

  it('greys out a done stop on the map', async () => {
    const { lastMarkers } = setup();

    await screen.findByRole('list', { name: 'Timeline' });

    await vi.waitFor(() =>
      expect(lastMarkers().find((m) => m.name === 'Senso-ji')).toMatchObject({ done: true }),
    );
    expect(lastMarkers().find((m) => m.name === 'Ueno ramen')?.done).toBeUndefined();
  });

  it('says what it does with your location before using it, and then replans from there', async () => {
    stubPosition((ok) =>
      ok({ coords: { latitude: 35.7, longitude: 139.8 } } as GeolocationPosition),
    );
    const { requests } = setup();

    expect(await screen.findByText(/uses your location once/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /recalculate from here/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.url === '/api/days/d1/solve')).toBe(true));
    expect(requests.find((r) => r.url === '/api/days/d1/solve')!.body).toEqual({
      mode: 'full',
      from: { lat: 35.7, lng: 139.8 },
      now: 630,
    });
  });

  it('starts the timeline at your location when the day was replanned from there', async () => {
    setup(route({ live: { lat: 35.7, lng: 139.8, time: 630 } }));

    const timeline = await screen.findByRole('list', { name: 'Timeline' });

    expect(within(timeline).getByText('Your location')).toBeInTheDocument();
    expect(within(timeline).getByText('10:30')).toBeInTheDocument();
  });

  it('lists the stops that are done after the start of the day, in the order they happened', async () => {
    setup();

    const rows = within(await screen.findByRole('list', { name: 'Timeline' })).getAllByRole(
      'listitem',
    );

    expect(rows[0]).toHaveTextContent('Hotel');
    expect(rows[1]).toHaveTextContent('Senso-ji');
    expect(rows[1]).toHaveTextContent(/done/i);
  });

  it('puts the done stops before "Your location" when the day was replanned from there', async () => {
    setup(route({ live: { lat: 35.7, lng: 139.8, time: 630 } }));

    const rows = within(await screen.findByRole('list', { name: 'Timeline' })).getAllByRole(
      'listitem',
    );

    expect(rows[0]).toHaveTextContent('Senso-ji');
    expect(rows[1]).toHaveTextContent('Your location');
  });

  it('offers to replan from where you are only on the day itself', async () => {
    setup(route(), new Date(2027, 2, 20, 10, 30)); // twelve days before the day

    await screen.findByRole('list', { name: 'Timeline' });

    expect(
      screen.queryByRole('button', { name: /recalculate from here/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/uses your location once/i)).not.toBeInTheDocument();
  });

  it('says to answer the browser question when the location does not come in time', async () => {
    stubPosition((_ok, fail) => fail({ code: 3 } as GeolocationPositionError));
    setup();

    await userEvent.click(await screen.findByRole('button', { name: /recalculate from here/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/answer the question|allow/i);
  });

  it('explains how to allow it when location is refused, and asks the server nothing', async () => {
    stubPosition((_ok, fail) => fail({ code: 1 } as GeolocationPositionError));
    const { requests } = setup();

    await userEvent.click(await screen.findByRole('button', { name: /recalculate from here/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/allow location/i);
    expect(requests.some((r) => r.url === '/api/days/d1/solve')).toBe(false);
  });
});
