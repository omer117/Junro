import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../map/fakeEngine';
import { MapEngineProvider } from '../map/MapEngineContext';
import { DayScreen } from './DayScreen';
import type { DayDetail, Stage } from './types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const dayOf = (id: string, date: string, segmentId: string | null): DayDetail => ({
  id,
  tripId: 't1',
  segmentId,
  date,
  start: { lat: 35.68, lng: 139.76 },
  end: { lat: 35.68, lng: 139.76 },
  startName: 'Hotel',
  endName: 'Hotel',
  startTime: 540,
  endTime: null,
  travelMode: 'walking',
  stageCount: 1,
});

const stage: Stage = {
  id: 's1',
  dayId: 'd1',
  segmentId: 'st1',
  pinnedTime: 1170,
  category: 'restaurant',
  stayOverrideMinutes: null,
  done: false,
  priority: 'must',
  dropped: false,
  position: null,
  place: { id: 'p1', googlePlaceId: 'g1', name: 'Dinner place', lat: 35.7, lng: 139.8 },
};

afterEach(() => vi.unstubAllGlobals());

function setup(segmentId: string | null) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET')
        return json(200, dayOf('d1', '2027-04-01', segmentId));
      if (url === '/api/days/d1/stages') return json(200, [stage]);
      if (url === '/api/days/d1/route') return json(204, null);
      if (url === '/api/segments/st1') {
        return json(200, {
          id: 'st1',
          tripId: 't1',
          name: 'Tokyo',
          hotel: { lat: 35.68, lng: 139.76 },
          hotelName: 'Hotel',
          travelMode: 'walking',
          startTime: 540,
          endTime: null,
          firstDate: '2027-04-01',
          dayCount: 2,
          placeCount: 1,
          days: [dayOf('d1', '2027-04-01', 'st1'), dayOf('d2', '2027-04-02', 'st1')],
        });
      }
      if (url.startsWith('/api/stages/') && method === 'PATCH') return json(200, stage);
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
  return requests;
}

describe('a day that is part of a stay', () => {
  it('shows a booked stop with its time as words', async () => {
    setup('st1');

    expect(await screen.findByText(/Booked 19:30/)).toBeInTheDocument();
  });

  it('can move a stop to another day of the stay, or back to the places to fit in', async () => {
    const requests = setup('st1');

    const menu = await screen.findByRole('combobox', { name: 'Move Dinner place to' });
    await userEvent.selectOptions(menu, 'd2');
    await vi.waitFor(() =>
      expect(
        requests.find((r) => r.url === '/api/stages/s1' && r.method === 'PATCH')?.body,
      ).toEqual({
        dayId: 'd2',
      }),
    );

    await userEvent.selectOptions(menu, 'pool');
    await vi.waitFor(() =>
      expect(
        requests.filter((r) => r.url === '/api/stages/s1' && r.method === 'PATCH'),
      ).toHaveLength(2),
    );
  });

  it('offers no move for a day that is not part of a stay', async () => {
    setup(null);
    await screen.findByRole('list', { name: 'Stops' });

    expect(
      screen.queryByRole('combobox', { name: /Move Dinner place to/ }),
    ).not.toBeInTheDocument();
  });
});
