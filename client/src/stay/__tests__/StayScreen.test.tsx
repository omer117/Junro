import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Stage } from '../../day/types';
import { fakeEngine } from '../../map/fakeEngine';
import { MapEngineProvider } from '../../map/MapEngineContext';
import type { MapMarker } from '../../map/engine';
import { StayScreen } from '../StayScreen';
import type { Proposal, StayDetail } from '../types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const day = (id: string, date: string) => ({
  id,
  tripId: 't1',
  segmentId: 's1',
  date,
  start: { lat: 35.68, lng: 139.76 },
  end: { lat: 35.68, lng: 139.76 },
  startName: 'Hotel Gracery',
  endName: 'Hotel Gracery',
  startTime: 540,
  endTime: null,
  travelMode: 'walking' as const,
  stageCount: 0,
});

const stay: StayDetail = {
  id: 's1',
  tripId: 't1',
  name: 'Tokyo',
  hotel: { lat: 35.68, lng: 139.76 },
  hotelName: 'Hotel Gracery',
  travelMode: 'walking',
  startTime: 540,
  endTime: null,
  firstDate: '2027-04-01',
  dayCount: 2,
  placeCount: 2,
  days: [day('d1', '2027-04-01'), day('d2', '2027-04-02')],
};

const place = (id: string, name: string, extra: Partial<Stage> = {}): Stage => ({
  id,
  dayId: null,
  segmentId: 's1',
  pinnedTime: null,
  category: 'temple',
  stayOverrideMinutes: null,
  done: false,
  priority: 'must',
  dropped: false,
  position: null,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 },
  ...extra,
});

const proposal: Proposal = {
  days: [
    {
      dayId: 'd1',
      order: ['a'],
      visits: [{ stageId: 'a', arrival: 560, serviceStart: 560, departure: 620, waited: 0 }],
      endArrival: 700,
      violations: [],
      dropped: [],
    },
    {
      dayId: 'd2',
      order: ['b'],
      visits: [{ stageId: 'b', arrival: 560, serviceStart: 560, departure: 620, waited: 0 }],
      endArrival: 700,
      violations: [],
      dropped: [],
    },
  ],
  leftOut: [{ id: 'c', reason: 'closed_all_days' }],
  frozenDayIds: [],
  score: { lateness: 0, droppedOptional: 0, travel: 60, imbalance: 0 },
  moved: [{ stageId: 'b', fromDayId: 'd1' }],
  inputHash: 'hash1',
  estimated: true,
};

afterEach(() => vi.unstubAllGlobals());

function setup(places: Stage[] = [place('a', 'Senso-ji'), place('b', 'Ueno Park')]) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/segments/s1' && method === 'GET') return json(200, stay);
      if (url === '/api/segments/s1/places') return json(200, places);
      if (url === '/api/segments/s1/split' && method === 'POST') return json(200, proposal);
      if (url === '/api/segments/s1/split/accept') return json(200, { ok: true, inPool: 1 });
      if (url.startsWith('/api/stages/') && method === 'PATCH') return json(200, places[0]);
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const fake = fakeEngine();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MapEngineProvider loader={async () => fake.engine}>
        <MemoryRouter initialEntries={['/segments/s1']}>
          <Routes>
            <Route path="/segments/:stayId" element={<StayScreen />} />
          </Routes>
        </MemoryRouter>
      </MapEngineProvider>
    </QueryClientProvider>,
  );
  const lastMarkers = () =>
    (fake.created[0]?.map.setMarkers.mock.calls.at(-1)?.[0] ?? []) as MapMarker[];
  return { requests, lastMarkers };
}

describe('the stay screen', () => {
  it('lists the places to fit in, with Must / If time for each', async () => {
    const { requests } = setup();

    const list = await screen.findByRole('list', { name: 'Places to fit in' });
    expect(within(list).getByText('Senso-ji')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Priority for Senso-ji' });
    await userEvent.click(within(group).getByRole('radio', { name: 'If time' }));

    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/stages/a' && r.method === 'PATCH')?.body).toEqual(
        {
          priority: 'optional',
        },
      ),
    );
  });

  it('books a place for a day and a time, and shows a badge with words', async () => {
    const { requests } = setup();

    await userEvent.click(await screen.findByRole('button', { name: 'Book a time for Senso-ji' }));
    const form = screen.getByRole('group', { name: 'Book Senso-ji' });
    await userEvent.click(within(form).getByRole('radio', { name: /Fri, Apr 2/ }));
    const time = within(form).getByLabelText('Time');
    await userEvent.clear(time);
    await userEvent.type(time, '19:30');
    await userEvent.click(within(form).getByRole('button', { name: 'Save booking' }));

    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/stages/a' && r.method === 'PATCH')?.body).toEqual(
        {
          dayId: 'd2',
          pinnedTime: 1170,
        },
      ),
    );
  });

  it('shows a booked place with its time as words', async () => {
    setup([place('a', 'Senso-ji', { dayId: 'd1', pinnedTime: 1170 })]);

    expect(await screen.findByText(/Booked 19:30/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Places on a day' })).toBeInTheDocument();
  });

  it('splits into days, shows the proposal with the reasons, and saves it only when accepted', async () => {
    const { requests } = setup();

    await userEvent.click(await screen.findByRole('button', { name: 'Split into days' }));

    const heading = await screen.findByRole('heading', { name: 'Your plan for Tokyo' });
    const review = heading.closest('section')!;
    expect(within(review).getByText(/estimates from distances/i)).toBeInTheDocument();
    expect(within(review).getByText(/Moved from Thu/)).toBeInTheDocument();
    expect(within(review).getByText(/Closed on all your Tokyo days/)).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith('/split/accept'))).toBe(false);

    await userEvent.click(within(review).getByRole('button', { name: 'Use this plan' }));
    await vi.waitFor(() =>
      expect(requests.find((r) => r.url.endsWith('/split/accept'))?.body).toEqual({
        inputHash: 'hash1',
        days: [
          { dayId: 'd1', stageIds: ['a'] },
          { dayId: 'd2', stageIds: ['b'] },
        ],
      }),
    );
  });

  it('goes back to editing without saving', async () => {
    const { requests } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Split into days' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Back to editing' }));

    expect(await screen.findByRole('list', { name: 'Places to fit in' })).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith('/split/accept'))).toBe(false);
  });

  it('numbers the places on the map with their proposed day', async () => {
    const { lastMarkers } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Split into days' }));
    await screen.findByRole('heading', { name: 'Your plan for Tokyo' });

    await vi.waitFor(() => {
      expect(lastMarkers().find((m) => m.name === 'Senso-ji')?.number).toBe(1);
      expect(lastMarkers().find((m) => m.name === 'Ueno Park')?.number).toBe(2);
    });
  });
});
