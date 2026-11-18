import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../../map/fakeEngine';
import { MapEngineProvider } from '../../map/MapEngineContext';
import type { MapMarker } from '../../map/engine';
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
  travelMode: 'walking',
  stageCount: 3,
};

const stage = (
  id: string,
  name: string,
  position: number | null,
  extra: Partial<Stage> = {},
): Stage => ({
  id,
  dayId: 'd1',
  category: 'temple',
  stayOverrideMinutes: null,
  done: false,
  priority: 'must',
  dropped: false,
  position,
  place: { id: `p-${id}`, googlePlaceId: `g-${id}`, name, lat: 35.7, lng: 139.8 },
  ...extra,
});

const route = (overrides: Partial<RouteResult> = {}): RouteResult => ({
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
  routeLine: 'LINE',
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

function setup(
  options: {
    stages?: Stage[];
    saved?: RouteResult | null;
    day?: DayDetail;
    patchDay?: () => Response;
  } = {},
) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const stages = options.stages ?? [stage('s1', 'Senso-ji', 0), stage('s2', 'Ueno ramen', 1)];
  const theDay = options.day ?? day;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1' && method === 'GET') return json(200, theDay);
      if (url === '/api/days/d1' && method === 'PATCH') {
        return (options.patchDay ?? (() => json(200, theDay)))();
      }
      if (url === '/api/days/d1/stages' && method === 'GET') return json(200, stages);
      if (url === '/api/days/d1/route') {
        return options.saved === null || options.saved === undefined
          ? json(204, null)
          : json(200, options.saved);
      }
      if (url === '/api/days/d1/solve' && method === 'POST') return json(200, route());
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

describe('how important a stop is', () => {
  it('shows each stop as a must by default, and lets you say "if there is time"', async () => {
    const { requests } = setup();

    const group = await screen.findByRole('radiogroup', { name: 'Priority for Senso-ji' });
    expect(within(group).getByRole('radio', { name: 'Must' })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: 'If time' }));

    await vi.waitFor(() =>
      expect(
        requests.find((r) => r.url === '/api/stages/s1' && r.method === 'PATCH')?.body,
      ).toEqual({ priority: 'optional' }),
    );
  });

  it('shows a stop that was already chosen as optional', async () => {
    setup({ stages: [stage('s1', 'Senso-ji', 0, { priority: 'optional' })] });

    const group = await screen.findByRole('radiogroup', { name: 'Priority for Senso-ji' });

    expect(within(group).getByRole('radio', { name: 'If time' })).toBeChecked();
  });
});

describe('the day end time', () => {
  it('can be set, and sends the minutes since midnight', async () => {
    const { requests } = setup();

    const field = await screen.findByLabelText(/day ends at/i);
    await userEvent.type(field, '22:00');

    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/days/d1' && r.method === 'PATCH')?.body).toEqual({
        endTime: 1320,
      }),
    );
  });

  it('shows the time it has, and can be cleared', async () => {
    const { requests } = setup({ day: { ...day, endTime: 1320 } });

    const field = (await screen.findByLabelText(/day ends at/i)) as HTMLInputElement;
    expect(field.value).toBe('22:00');
    await userEvent.click(screen.getByRole('button', { name: /no end time/i }));

    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/days/d1' && r.method === 'PATCH')?.body).toEqual({
        endTime: null,
      }),
    );
  });

  it('says so when the server refuses it (before the day starts)', async () => {
    setup({
      patchDay: () =>
        json(400, {
          error: { code: 'validation_error', message: 'The day must end after it starts' },
        }),
    });

    await userEvent.type(await screen.findByLabelText(/day ends at/i), '07:00');

    expect(await screen.findByRole('alert')).toHaveTextContent(/must end after it starts/i);
  });
});

describe('stops that did not fit today', () => {
  const droppedStages = [
    stage('s1', 'Senso-ji', 0),
    stage('s2', 'Ueno ramen', null, { priority: 'optional', dropped: true }),
  ];
  const savedWithDrop = route({
    order: ['s1'],
    visits: [{ stageId: 's1', arrival: 560, serviceStart: 560, departure: 600, waited: 0 }],
    dropped: ['s2'],
  });

  it('lists them under the route, in words, instead of hiding them', async () => {
    setup({ stages: droppedStages, saved: savedWithDrop });

    const heading = await screen.findByRole('heading', { name: "Didn't fit today" });
    const section = heading.closest('section')!;

    expect(within(section).getByText('Ueno ramen')).toBeInTheDocument();
    expect(section).toHaveTextContent(/left out to keep the rest on time/i);
  });

  it('puts one back by making it a must and calculating again', async () => {
    const { requests } = setup({ stages: droppedStages, saved: savedWithDrop });

    await userEvent.click(await screen.findByRole('button', { name: 'Make Ueno ramen a must' }));

    await vi.waitFor(() =>
      expect(
        requests.find((r) => r.url === '/api/stages/s2' && r.method === 'PATCH')?.body,
      ).toEqual({ priority: 'must' }),
    );
    await vi.waitFor(() =>
      expect(requests.find((r) => r.url === '/api/days/d1/solve')?.body).toEqual({ mode: 'full' }),
    );
  });

  it('does not offer "Update your route" for a stop that was left out', async () => {
    setup({ stages: droppedStages, saved: null });
    await screen.findByRole('list', { name: 'Stops' });

    expect(screen.queryByRole('heading', { name: 'Update your route' })).not.toBeInTheDocument();
  });

  it('draws a left-out stop on the map without a number, and numbers the others', async () => {
    const { lastMarkers } = setup({ stages: droppedStages, saved: savedWithDrop });

    await screen.findByRole('heading', { name: "Didn't fit today" });

    await vi.waitFor(() => {
      const senso = lastMarkers().find((m) => m.name === 'Senso-ji');
      const ueno = lastMarkers().find((m) => m.name === 'Ueno ramen');
      expect(senso?.number).toBe(1);
      expect(ueno).toMatchObject({ state: 'dropped' });
      expect(ueno?.number).toBeUndefined();
    });
  });
});

describe('a day that ends later than its end time', () => {
  it('says by how much, in words (the stops that are a must are never dropped)', async () => {
    setup({
      saved: route({ violations: [{ kind: 'past_day_end', minutesLate: 45 }], totalLateness: 45 }),
    });

    expect(
      await screen.findByText(/45 min after the time you wanted the day to end/i),
    ).toBeInTheDocument();
  });
});
