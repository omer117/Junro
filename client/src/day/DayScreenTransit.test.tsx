import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
  startPlaceId: 'ChIJ-the-hotel',
  endPlaceId: 'ChIJ-the-hotel',
  startTime: 540,
  travelMode: 'transit',
  stageCount: 2,
};

const stage = (id: string, name: string, position: number): Stage => ({
  id,
  dayId: 'd1',
  category: 'temple',
  stayOverrideMinutes: null,
  done: false,
  position,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 },
});

const route: RouteResult = {
  mode: 'saved',
  order: ['s1', 's2'],
  visits: [
    { stageId: 's1', arrival: 545, serviceStart: 545, departure: 565, waited: 0 },
    { stageId: 's2', arrival: 583, serviceStart: 583, departure: 603, waited: 0 },
  ],
  endArrival: 623,
  violations: [],
  totalLateness: 0,
  live: null,
  legs: [
    { mode: 'walk', minutes: 5 },
    { mode: 'transit', minutes: 18 },
    { mode: 'transit', minutes: 20 },
  ],
  routeLine: 'LINE',
};

const options = [
  {
    minutes: 30,
    walkMinutes: 4,
    transfers: 1,
    steps: [
      { kind: 'walk', minutes: 2 },
      { kind: 'transit', minutes: 12, line: 'Yamanote Line', stops: 5, headsign: 'Shinjuku' },
      { kind: 'transit', minutes: 14, line: 'Chuo Line', stops: 4 },
      { kind: 'walk', minutes: 2 },
    ],
  },
  {
    minutes: 40,
    walkMinutes: 1,
    transfers: 0,
    steps: [
      { kind: 'walk', minutes: 1 },
      { kind: 'transit', minutes: 38, line: 'Ginza Line', stops: 9 },
    ],
  },
  { minutes: 50, walkMinutes: 50, transfers: 0, steps: [{ kind: 'walk', minutes: 50 }] },
];

afterEach(() => vi.unstubAllGlobals());

function setup(saved: RouteResult = route) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const stages = [stage('s1', 'Senso-ji', 0), stage('s2', 'Shibuya Station', 1)];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, day);
      if (url === '/api/days/d1' && method === 'PATCH') return json(200, day);
      if (url === '/api/days/d1/stages' && method === 'GET') return json(200, stages);
      if (url === '/api/days/d1/route') return json(200, saved);
      if (url.startsWith('/api/days/d1/legs/')) return json(200, { options });
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
  return { requests };
}

const mapsLink = (name: string) => screen.getByRole('link', { name }) as HTMLAnchorElement;
const modeOf = (link: HTMLAnchorElement) => new URL(link.href).searchParams.get('travelmode');

describe('opening each leg in Google Maps', () => {
  it('has a link on every leg, in the way that leg is travelled', async () => {
    setup();

    await screen.findByRole('list', { name: 'Timeline' });

    const first = mapsLink('Open Hotel to Senso-ji in Google Maps');
    const second = mapsLink('Open Senso-ji to Shibuya Station in Google Maps');
    const last = mapsLink('Open Shibuya Station to Hotel in Google Maps');
    expect([modeOf(first), modeOf(second), modeOf(last)]).toEqual([
      'walking',
      'transit',
      'transit',
    ]);
  });

  it('goes from the right place to the right place, naming the places Google knows', async () => {
    setup();

    await screen.findByRole('list', { name: 'Timeline' });

    const url = new URL(mapsLink('Open Senso-ji to Shibuya Station in Google Maps').href);
    expect(url.searchParams.get('origin')).toBe('35.7,139.8');
    expect(url.searchParams.get('origin_place_id')).toBe('g-s1');
    expect(url.searchParams.get('destination_place_id')).toBe('g-s2');
    const fromHotel = new URL(mapsLink('Open Hotel to Senso-ji in Google Maps').href);
    expect(fromHotel.searchParams.get('origin')).toBe('35.68,139.76');
    expect(fromHotel.searchParams.get('origin_place_id')).toBe('ChIJ-the-hotel');
  });

  it('opens in a new tab, so the plan stays where it is', async () => {
    setup();

    await screen.findByRole('list', { name: 'Timeline' });

    const link = mapsLink('Open Hotel to Senso-ji in Google Maps');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.rel).toContain('noopener');
  });

  it('asks Google Maps for public transport on every leg where our own data has none', async () => {
    setup({
      ...route,
      transitAvailable: false,
      legs: route.legs!.map((leg) => ({ ...leg, mode: 'walk' as const })),
    });

    await screen.findByRole('list', { name: 'Timeline' });

    expect(modeOf(mapsLink('Open Hotel to Senso-ji in Google Maps'))).toBe('transit');
    expect(modeOf(mapsLink('Open Senso-ji to Shibuya Station in Google Maps'))).toBe('transit');
  });
});

describe('a public transport day without public transport data', () => {
  it('says why every leg is walked, instead of silently walking', async () => {
    setup({
      ...route,
      transitAvailable: false,
      legs: route.legs!.map((leg) => ({ ...leg, mode: 'walk' as const })),
    });

    const note = await screen.findByText(/public transport is not available/i);

    expect(note).toHaveTextContent(/on foot/i);
    expect(note).toHaveTextContent(/Japan/);
  });

  it('says nothing when public transport works', async () => {
    setup(route);

    await screen.findByRole('list', { name: 'Timeline' });

    expect(screen.queryByText(/not available/i)).not.toBeInTheDocument();
  });
});

describe('a public transport day', () => {
  it('shows every leg of the day: walked, or by public transport, and how long', async () => {
    setup();

    const timeline = await screen.findByRole('list', { name: 'Timeline' });

    expect(within(timeline).getByText('Walk · 5 min')).toBeInTheDocument();
    expect(within(timeline).getByText('Transit · 18 min')).toBeInTheDocument();
    expect(within(timeline).getByText('Transit · 20 min')).toBeInTheDocument();
  });

  it('offers other ways only for the legs that are by public transport', async () => {
    setup();

    await screen.findByRole('list', { name: 'Timeline' });

    expect(
      screen.queryByRole('button', { name: 'Other ways from Hotel to Senso-ji' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Other ways from Senso-ji to Shibuya Station' }),
    ).toBeInTheDocument();
  });

  it('asks for the ways when you open them, for the time that leg starts', async () => {
    const { requests } = setup();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Other ways from Senso-ji to Shibuya Station' }),
    );

    expect(await screen.findByText(/Yamanote Line/)).toBeInTheDocument();
    // The leg starts when you leave Senso-ji: 565 minutes (9:25).
    expect(requests.some((r) => r.url === '/api/days/d1/legs/1/alternatives?at=565')).toBe(true);
  });

  it('lists the options in words: how long, how much walking, how many changes', async () => {
    setup();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Other ways from Senso-ji to Shibuya Station' }),
    );

    const list = await screen.findByRole('list', { name: 'Ways to get there' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('30 min');
    expect(items[0]).toHaveTextContent('1 change');
    expect(items[0]).toHaveTextContent('4 min walking');
    expect(items[1]).toHaveTextContent('No changes');
    expect(items[0]).toHaveTextContent('Yamanote Line');
  });

  it('puts them in the order you prefer, without asking again', async () => {
    const { requests } = setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Other ways from Senso-ji to Shibuya Station' }),
    );
    const list = await screen.findByRole('list', { name: 'Ways to get there' });
    const asked = requests.length;

    await userEvent.click(screen.getByRole('radio', { name: 'Least walking' }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('40 min');

    await userEvent.click(screen.getByRole('radio', { name: 'Fewest changes' }));
    // Two options have no changes; the quicker of them is first.
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('40 min');
    expect(requests.length).toBe(asked);

    await userEvent.click(screen.getByRole('radio', { name: 'Fastest' }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('30 min');
  });

  it('can be chosen as the travel mode', async () => {
    const { requests } = setup();

    const group = await screen.findByRole('radiogroup', { name: 'Travel mode' });
    expect(within(group).getByRole('radio', { name: 'Transit' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'Walking' }));

    await vi.waitFor(() =>
      expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ travelMode: 'walking' }),
    );
  });
});
