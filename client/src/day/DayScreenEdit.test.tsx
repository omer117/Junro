import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../map/fakeEngine';
import { MapEngineProvider } from '../map/MapEngineContext';
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

const stage = (id: string, name: string, position: number | null): Stage => ({
  id,
  dayId: 'd1',
  category: 'temple',
  stayOverrideMinutes: null,
  done: false,
  position,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 },
});

const solved: RouteResult = {
  mode: 'full',
  order: ['s1', 's2'],
  visits: [
    { stageId: 's1', arrival: 560, serviceStart: 560, departure: 600, waited: 0 },
    { stageId: 's2', arrival: 660, serviceStart: 660, departure: 700, waited: 0 },
  ],
  endArrival: 760,
  violations: [],
  totalLateness: 0,
  routeLine: 'LINE',
};

afterEach(() => vi.unstubAllGlobals());

function setup(stages: Stage[], saved: RouteResult | null) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, day);
      if (url === '/api/days/d1/stages' && method === 'GET') return json(200, stages);
      if (url === '/api/days/d1/route') {
        return saved
          ? json(200, { ...saved, mode: 'saved' })
          : json(404, { error: { code: 'no_route', message: 'x' } });
      }
      if (url === '/api/days/d1/solve' && method === 'POST') return json(200, solved);
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
  const solveBodies = () =>
    requests.filter((r) => r.url === '/api/days/d1/solve').map((r) => r.body);
  return { solveBodies };
}

describe('editing a day that already has a route', () => {
  const added = [
    stage('s1', 'Senso-ji', 0),
    stage('s2', 'Ueno ramen', 1),
    stage('s3', 'Kappabashi', null),
  ];

  it('offers two ways to fit the new stop in, and explains each', async () => {
    setup(added, null);

    expect(await screen.findByRole('heading', { name: /update your route/i })).toBeInTheDocument();
    expect(screen.getByText(/added 1 stop to a day that already has a route/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep my order/i })).toBeInTheDocument();
    expect(screen.getByText(/new stops go where they add the least time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recalculate everything/i })).toBeInTheDocument();
    expect(screen.getByText(/may reorder your day/i)).toBeInTheDocument();
  });

  it('keeps the order: asks for a minimal change', async () => {
    const { solveBodies } = setup(added, null);

    await userEvent.click(await screen.findByRole('button', { name: /keep my order/i }));

    await vi.waitFor(() => expect(solveBodies()).toEqual([{ mode: 'minimal' }]));
  });

  it('recalculates everything: asks for a full solve', async () => {
    const { solveBodies } = setup(added, null);

    await userEvent.click(await screen.findByRole('button', { name: /recalculate everything/i }));

    await vi.waitFor(() => expect(solveBodies()).toEqual([{ mode: 'full' }]));
  });

  it('counts several new stops', async () => {
    setup([stage('s1', 'A', 0), stage('s2', 'B', null), stage('s3', 'C', null)], null);

    expect(
      await screen.findByText(/added 2 stops to a day that already has a route/i),
    ).toBeInTheDocument();
  });

  it('does not ask a question when there is no route yet: just Find my route', async () => {
    setup([stage('s1', 'A', null), stage('s2', 'B', null)], null);

    expect(await screen.findByRole('button', { name: /find my route/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /keep my order/i })).toBeNull();
  });

  it('offers to redraw the line after a stop was removed (the route is still good, the line is not)', async () => {
    const { solveBodies } = setup([stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)], {
      ...solved,
      routeLine: null,
    });

    await userEvent.click(await screen.findByRole('button', { name: /redraw the line/i }));

    await vi.waitFor(() => expect(solveBodies()).toEqual([{ mode: 'minimal' }]));
  });
});
