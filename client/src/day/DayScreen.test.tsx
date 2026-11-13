import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../map/fakeEngine';
import { MapEngineProvider } from '../map/MapEngineContext';
import type { MapMarker } from '../map/engine';
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

const stage = (
  id: string,
  name: string,
  category: Stage['category'],
  over: Partial<Stage> = {},
): Stage => ({
  id,
  dayId: 'd1',
  category,
  stayOverrideMinutes: null,
  done: false,
  position: null,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 },
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

function setup(
  options: {
    stages?: Stage[];
    day?: DayDetail;
    handlers?: Record<string, (init?: RequestInit) => Response>;
  } = {},
) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const stages = options.stages ?? [
    stage('s1', 'Senso-ji', 'temple'),
    stage('s2', 'Ueno ramen', 'restaurant'),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const handler = options.handlers?.[`${method} ${url}`];
      if (handler) return handler(init);
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, options.day ?? day);
      if (url === '/api/days/d1/stages' && method === 'GET') return json(200, stages);
      if (url.startsWith('/api/places/search'))
        return json(200, [{ googlePlaceId: 'ChIJ-new-place-1', text: 'Kappabashi Street' }]);
      if (url === '/api/places' && method === 'POST')
        return json(201, {
          id: 'pn',
          googlePlaceId: 'ChIJ-new-place-1',
          name: 'Kappabashi Street',
          lat: 35.71,
          lng: 139.79,
        });
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
            <Route path="/" element={<p>Trips home</p>} />
          </Routes>
        </MemoryRouter>
      </MapEngineProvider>
    </QueryClientProvider>,
  );
  const lastMarkers = (): MapMarker[] =>
    (fake.created[0]?.map.setMarkers.mock.calls.at(-1)?.[0] ?? []) as MapMarker[];
  return { requests, fake, lastMarkers };
}

describe('DayScreen', () => {
  it('shows the day, its number of stops and its stops with their categories', async () => {
    setup();

    expect(await screen.findByRole('heading', { name: 'Thu, Apr 1' })).toBeInTheDocument();
    expect(screen.getByText(/2 stops/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /stops/i });
    expect(within(list).getByText('Senso-ji')).toBeInTheDocument();
    expect(within(list).getByText('Ueno ramen')).toBeInTheDocument();
    expect(within(list).getByLabelText(/category for senso-ji/i)).toHaveValue('temple');
  });

  it('puts the ends of the day and every stop on the map', async () => {
    const { lastMarkers } = setup();

    await vi.waitFor(() => expect(lastMarkers().length).toBeGreaterThan(0));
    const markers = lastMarkers();
    // The day starts and ends at the same hotel, so the map gets one joined pin.
    expect(markers.find((m) => m.kind === 'loop')).toMatchObject({
      label: 'Start · 9:00',
      endLabel: 'End · Hotel',
    });
    expect(markers.filter((m) => m.kind === 'stage').map((m) => m.name)).toEqual([
      'Senso-ji',
      'Ueno ramen',
    ]);
    expect(markers.filter((m) => m.kind === 'stage').every((m) => m.number === undefined)).toBe(
      true,
    );
  });

  it('numbers the stops once the day has a route', async () => {
    const { lastMarkers } = setup({
      stages: [
        stage('s1', 'Ueno ramen', 'restaurant', { position: 1 }),
        stage('s2', 'Senso-ji', 'temple', { position: 0 }),
      ],
    });

    await vi.waitFor(() => expect(lastMarkers().some((m) => m.number !== undefined)).toBe(true));
    const byNumber = lastMarkers()
      .filter((m) => m.kind === 'stage')
      .sort((a, b) => a.number! - b.number!);
    expect(byNumber.map((m) => [m.number, m.name])).toEqual([
      [1, 'Senso-ji'],
      [2, 'Ueno ramen'],
    ]);
  });

  it('lists the stops in route order when there is a route', async () => {
    setup({
      stages: [
        stage('s1', 'Ueno ramen', 'restaurant', { position: 1 }),
        stage('s2', 'Senso-ji', 'temple', { position: 0 }),
      ],
    });

    const list = await screen.findByRole('list', { name: /stops/i });
    const names = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(names[0]).toContain('Senso-ji');
    expect(names[1]).toContain('Ueno ramen');
  });

  it('switches between walking and driving', async () => {
    const { requests } = setup({
      handlers: { 'PATCH /api/days/d1': () => json(200, { ...day, travelMode: 'driving' }) },
    });
    const group = await screen.findByRole('radiogroup', { name: /travel mode/i });
    expect(within(group).getByRole('radio', { name: 'Walking' })).toBeChecked();

    await userEvent.click(within(group).getByRole('radio', { name: 'Driving' }));

    await vi.waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true));
    expect(requests.find((r) => r.method === 'PATCH')!.body).toEqual({ travelMode: 'driving' });
  });

  it('shows transit as coming later, and not selectable', async () => {
    setup();

    const group = await screen.findByRole('radiogroup', { name: /travel mode/i });
    expect(within(group).getByRole('radio', { name: /transit/i })).toBeDisabled();
  });

  it('adds a stop: search, choose the place, then say what kind of place it is', async () => {
    const { requests } = setup({
      handlers: {
        'POST /api/days/d1/stages': () => json(201, stage('s3', 'Kappabashi Street', 'shop')),
      },
    });
    await userEvent.type(await screen.findByLabelText(/add a stop/i), 'kappa');
    await userEvent.click(await screen.findByRole('button', { name: /Kappabashi Street/ }));

    expect(
      await screen.findByRole('heading', { name: /what kind of place is kappabashi street/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Shop' }));

    await vi.waitFor(() =>
      expect(requests.some((r) => r.url === '/api/days/d1/stages' && r.method === 'POST')).toBe(
        true,
      ),
    );
    expect(
      requests.find((r) => r.method === 'POST' && r.url === '/api/days/d1/stages')!.body,
    ).toEqual({
      placeId: 'pn',
      category: 'shop',
    });
  });

  it('lets you change a category and remove a stop', async () => {
    const { requests } = setup({
      handlers: {
        'PATCH /api/stages/s1': () => json(200, stage('s1', 'Senso-ji', 'park')),
        'DELETE /api/stages/s2': () => new Response(null, { status: 204 }),
      },
    });
    const list = await screen.findByRole('list', { name: /stops/i });

    await userEvent.selectOptions(within(list).getByLabelText(/category for senso-ji/i), 'park');
    await userEvent.click(within(list).getByRole('button', { name: /remove ueno ramen/i }));

    await vi.waitFor(() => {
      expect(requests.some((r) => r.method === 'PATCH' && r.url === '/api/stages/s1')).toBe(true);
      expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/stages/s2')).toBe(true);
    });
    expect(requests.find((r) => r.url === '/api/stages/s1')!.body).toEqual({ category: 'park' });
  });

  it('explains a full day', async () => {
    setup({
      handlers: {
        'POST /api/days/d1/stages': () =>
          json(409, { error: { code: 'day_full', message: 'A day can have at most 15 stages' } }),
      },
    });
    await userEvent.type(await screen.findByLabelText(/add a stop/i), 'kappa');
    await userEvent.click(await screen.findByRole('button', { name: /Kappabashi Street/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Shop' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 15 stops/i);
  });

  it('invites you to add a first stop on an empty day', async () => {
    setup({ stages: [], day: { ...day, stageCount: 0 } });

    expect(await screen.findByText(/no stops yet/i)).toBeInTheDocument();
  });

  it('has a way back to the trips', async () => {
    setup();

    expect(await screen.findByRole('link', { name: /back/i })).toHaveAttribute('href', '/');
  });

  it('says so when the day cannot be loaded', async () => {
    setup({
      handlers: {
        'GET /api/days/d1': () => json(404, { error: { code: 'not_found', message: 'x' } }),
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find this day/i);
  });
});
