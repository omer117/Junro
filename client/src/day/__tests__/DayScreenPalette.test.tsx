import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../../map/fakeEngine';
import { MapEngineProvider } from '../../map/MapEngineContext';
import type { MapMarker } from '../../map/engine';
import type { RouteResult } from '../../route/types';
import { PALETTES } from '../../styles/palettes';
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
  travelMode: 'walking',
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

const route: RouteResult = {
  mode: 'saved',
  order: ['s1', 's2'],
  visits: [
    { stageId: 's1', arrival: 560, serviceStart: 560, departure: 600, waited: 0 },
    { stageId: 's2', arrival: 640, serviceStart: 640, departure: 680, waited: 0 },
  ],
  endArrival: 720,
  violations: [{ stageId: 's2', kind: 'closed', minutesLate: 12 }],
  totalLateness: 12,
  dropped: [],
  live: null,
  // Google's documentation sample line, far from the stops (so it is drawn whole).
  routeLine: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
};

afterEach(() => vi.unstubAllGlobals());

function setup(countryCode: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/trips') {
        return json(200, [
          {
            id: 't1',
            name: 'Trip',
            createdAt: '2026-11-01T10:00:00Z',
            ...(countryCode
              ? {
                  destination: {
                    iata: 'XXX',
                    name: 'Airport',
                    city: 'City',
                    countryName: 'Country',
                    countryCode,
                  },
                }
              : {}),
          },
        ]);
      }
      if (url === '/api/days/d1' && method === 'GET') return json(200, day);
      if (url === '/api/days/d1/stages') {
        return json(200, [stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)]);
      }
      if (url === '/api/days/d1/route') return json(200, route);
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const fake = fakeEngine();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
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
  return { fake, view, lastMarkers };
}

describe('the day screen takes its colours from the trip', () => {
  it('a day of a Japan trip sets the sakura colours on the screen and gives the map the accent', async () => {
    const { fake, view } = setup('JP');

    await screen.findByRole('heading', { name: /Thu, Apr 1/ });

    await vi.waitFor(() => {
      const root = view.container.querySelector<HTMLElement>('.day-screen')!;
      expect(root.style.getPropertyValue('--accent')).toBe(PALETTES.sakura.accent);
      expect(root.style.getPropertyValue('--sky-warm')).toBe(PALETTES.sakura.skyWarm);
    });
    await vi.waitFor(() => {
      const call = fake.created[0]!.map.setRoute.mock.calls.at(-1);
      expect(call?.[1]).toEqual({ animate: false, accent: PALETTES.sakura.accent });
    });
  });

  it('keeps a warning a warning: a late stop is still late, and the warning colours are not touched', async () => {
    const { view, lastMarkers } = setup('JP');

    await vi.waitFor(() => expect(lastMarkers().find((m) => m.id === 's2')?.state).toBe('late'));

    const root = view.container.querySelector<HTMLElement>('.day-screen')!;
    for (const name of ['--warning', '--warning-text', '--on-warning']) {
      expect(root.style.getPropertyValue(name)).toBe('');
    }
  });

  it('a trip without a destination keeps Golden hour: nothing is set and the map gets no accent', async () => {
    const { fake, view } = setup(null);

    await screen.findByRole('heading', { name: /Thu, Apr 1/ });
    await vi.waitFor(() => {
      const call = fake.created[0]!.map.setRoute.mock.calls.at(-1);
      expect(call?.[1]).toEqual({ animate: false });
    });

    expect(
      view.container.querySelector<HTMLElement>('.day-screen')!.getAttribute('style'),
    ).toBeNull();
  });
});
