import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../../map/fakeEngine';
import { MapEngineProvider } from '../../map/MapEngineContext';
import type { RouteResult } from '../../route/types';
import { DayScreen } from '../DayScreen';
import type { DayDetail, Stage } from '../types';

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
  endTime: null,
  travelMode: 'transit',
  stageCount: 2,
};

const stage = (id: string, name: string, position: number): Stage => ({
  id,
  dayId: 'd1',
  category: 'temple',
  stayOverrideMinutes: null,
  done: false,
  priority: 'must',
  dropped: false,
  position,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 + position / 100 },
});

const stages = [stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)];

const route: RouteResult = {
  mode: 'saved',
  order: ['s1', 's2'],
  visits: [
    { stageId: 's1', arrival: 560, serviceStart: 560, departure: 600, waited: 0 },
    { stageId: 's2', arrival: 640, serviceStart: 640, departure: 680, waited: 0 },
  ],
  endArrival: 720,
  violations: [],
  totalLateness: 0,
  dropped: [],
  live: null,
  legs: [
    { mode: 'walk', minutes: 10 },
    { mode: 'transit', minutes: 12 },
    { mode: 'walk', minutes: 8 },
  ],
  // Google's documentation sample line: three points, far from the stops (so it is drawn whole).
  routeLine: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
};

afterEach(() => vi.unstubAllGlobals());

function setup(saved: RouteResult | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, day);
      if (url === '/api/days/d1/stages') return json(200, stages);
      if (url === '/api/days/d1/route') return saved ? json(200, saved) : json(204, null);
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
  return fake;
}

describe('choosing a stop on the map and in the plan', () => {
  it('tapping a stop on the map marks its row as current', async () => {
    const fake = setup(null);
    const list = await screen.findByRole('list', { name: 'Stops' });
    await vi.waitFor(() => expect(fake.created).toHaveLength(1));
    await vi.waitFor(() => expect(fake.created[0]!.map.onSelect).toHaveBeenCalled());

    act(() => fake.created[0]!.select('s2'));

    const rows = within(list).getAllByRole('listitem');
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(rows[0]).not.toHaveAttribute('aria-current');
  });

  it('tapping a row chooses the stop on the map, and tapping again clears it', async () => {
    const fake = setup(null);
    await userEvent.click(await screen.findByRole('button', { name: 'Ueno ramen' }));

    await vi.waitFor(() => expect(fake.created[0]!.map.setSelected).toHaveBeenLastCalledWith('s2'));
    expect(fake.created[0]!.map.panTo).toHaveBeenCalledWith('s2');

    await userEvent.click(screen.getByRole('button', { name: 'Ueno ramen' }));
    await vi.waitFor(() => expect(fake.created[0]!.map.setSelected).toHaveBeenLastCalledWith(null));
  });

  it('tapping the map (or Escape) clears the choice', async () => {
    const fake = setup(null);
    await userEvent.click(await screen.findByRole('button', { name: 'Senso-ji' }));
    await vi.waitFor(() => expect(fake.created[0]!.map.onSelect).toHaveBeenCalled());

    act(() => fake.created[0]!.select(null));

    expect(screen.getByRole('button', { name: 'Senso-ji' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('also works from the timeline of a planned day', async () => {
    const fake = setup(route);
    await userEvent.click(await screen.findByRole('button', { name: 'Ueno ramen' }));

    await vi.waitFor(() => expect(fake.created[0]!.map.setSelected).toHaveBeenLastCalledWith('s2'));
    expect(screen.getByRole('button', { name: 'Ueno ramen' }).closest('li')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('the map on a public transport day', () => {
  it('uses the transit look and gives the route as legs, each with its own way of travelling', async () => {
    const fake = setup(route);

    await vi.waitFor(() =>
      expect(fake.created[0]!.map.setBaseStyle).toHaveBeenCalledWith('transit'),
    );
    await vi.waitFor(() => {
      const call = fake.created[0]!.map.setRoute.mock.calls.at(-1);
      expect(call?.[0]).toEqual([expect.objectContaining({ mode: 'walk', travelled: false })]);
    });
  });
});
