import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
  stageCount: 2,
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
  routeLine: 'ENCODED-LINE',
};

afterEach(() => vi.unstubAllGlobals());

function setup(
  options: {
    stages?: Stage[];
    saved?: RouteResult | null;
    solve?: () => Response;
  } = {},
) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const stages = options.stages ?? [stage('s1', 'Senso-ji', null), stage('s2', 'Ueno ramen', null)];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, day);
      if (url === '/api/days/d1/stages' && method === 'GET') return json(200, stages);
      if (url === '/api/days/d1/route') {
        return options.saved
          ? json(200, { ...options.saved, mode: 'saved' })
          : json(404, { error: { code: 'no_route', message: 'This day has no route yet.' } });
      }
      if (url === '/api/days/d1/solve' && method === 'POST') {
        return (options.solve ?? (() => json(200, solved)))();
      }
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
  const lastRoute = () => fake.created[0]?.map.setRoute.mock.calls.at(-1);
  const lastMarkers = () =>
    (fake.created[0]?.map.setMarkers.mock.calls.at(-1)?.[0] ?? []) as MapMarker[];
  return { requests, fake, lastRoute, lastMarkers };
}

describe('Find my route', () => {
  it('is offered once there are stops, and asks the server for the best order', async () => {
    const { requests } = setup();

    await userEvent.click(await screen.findByRole('button', { name: /find my route/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.url === '/api/days/d1/solve')).toBe(true));
    expect(requests.find((r) => r.url === '/api/days/d1/solve')!.body).toEqual({ mode: 'full' });
  });

  it('cannot be pressed without a stop, and says why', async () => {
    setup({ stages: [] });

    const button = await screen.findByRole('button', { name: /find my route/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/add a stop to find a route/i)).toBeInTheDocument();
  });

  it('shows the answer in plain words and draws the line, animated', async () => {
    const { lastRoute } = setup();

    await userEvent.click(await screen.findByRole('button', { name: /find my route/i }));

    expect(
      await screen.findByRole('heading', { name: 'Back at Hotel by 12:40' }),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(lastRoute()).toEqual(['ENCODED-LINE', { animate: true }]));
  });

  it('shows the saved route when the day is opened, with the line but without the animation', async () => {
    const { lastRoute } = setup({
      saved: solved,
      stages: [stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)],
    });

    expect(
      await screen.findByRole('heading', { name: 'Back at Hotel by 12:40' }),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(lastRoute()).toEqual(['ENCODED-LINE', { animate: false }]));
  });

  it('marks a stop with a problem on the map, as well as in the timeline', async () => {
    const withProblem: RouteResult = {
      ...solved,
      violations: [{ stageId: 's2', kind: 'closed', minutesLate: 12 }],
    };
    const { lastMarkers } = setup({
      saved: withProblem,
      stages: [stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)],
    });

    expect(await screen.findByText(/about 12 min over/i)).toBeInTheDocument();
    await vi.waitFor(() => {
      const bad = lastMarkers().find((m) => m.id === 's2');
      expect(bad?.warning).toBe(true);
      expect(lastMarkers().find((m) => m.id === 's1')?.warning).toBeUndefined();
    });
  });

  it('lets you edit the day, and recalculate', async () => {
    const { requests } = setup({
      saved: solved,
      stages: [stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)],
    });

    await userEvent.click(await screen.findByRole('button', { name: /edit day/i }));
    expect(screen.getByRole('list', { name: /stops/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /recalculate route/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.url === '/api/days/d1/solve')).toBe(true));
  });

  it.each([
    ['quota_reached', 429, /monthly limit for route finding/i],
    ['rate_limited', 429, /too many route calculations/i],
    ['unreachable', 422, /no route connects these stops/i],
    ['google_unavailable', 502, /could not reach google/i],
    ['google_not_configured', 503, /not available right now/i],
  ])('explains the server error %s', async (code, status, text) => {
    setup({ solve: () => json(status, { error: { code, message: 'x' } }) });

    await userEvent.click(await screen.findByRole('button', { name: /find my route/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('keeps the button available after an error, to try again', async () => {
    setup({ solve: () => json(502, { error: { code: 'google_unavailable', message: 'x' } }) });

    await userEvent.click(await screen.findByRole('button', { name: /find my route/i }));
    await screen.findByRole('alert');

    expect(screen.getByRole('button', { name: /find my route/i })).toBeEnabled();
  });
});
