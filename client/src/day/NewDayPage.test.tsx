import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewDayPage } from './NewDayPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const hotel = {
  id: 'ph',
  googlePlaceId: 'ChIJ-hotel-000001',
  name: 'Hotel Gracery',
  lat: 35.695,
  lng: 139.702,
};
const station = {
  id: 'ps',
  googlePlaceId: 'ChIJ-station-0001',
  name: 'Ueno Station',
  lat: 35.713,
  lng: 139.777,
};

afterEach(() => vi.unstubAllGlobals());

function setup(createDay: () => Response = () => json(201, { id: 'newday' })) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/places/search')) {
        const q = new URL(url, 'http://x').searchParams.get('q')!.toLowerCase();
        return json(200, [
          q.startsWith('hot')
            ? { googlePlaceId: hotel.googlePlaceId, text: 'Hotel Gracery Shinjuku' }
            : { googlePlaceId: station.googlePlaceId, text: 'Ueno Station' },
        ]);
      }
      if (url === '/api/places' && method === 'POST') {
        const id = (JSON.parse(String(init!.body)) as { googlePlaceId: string }).googlePlaceId;
        return json(201, id === hotel.googlePlaceId ? hotel : station);
      }
      if (url === '/api/trips/t1/days' && method === 'POST') return createDay();
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/trips/t1/days/new']}>
        <Routes>
          <Route path="/trips/:tripId/days/new" element={<NewDayPage />} />
          <Route path="/days/:dayId" element={<p>The day screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return requests;
}

async function chooseStart() {
  await userEvent.type(screen.getByLabelText(/where does the day start/i), 'hotel');
  await userEvent.click(await screen.findByRole('button', { name: /Hotel Gracery/ }));
}

describe('NewDayPage', () => {
  it('creates a day that starts and ends at the hotel, and opens it', async () => {
    const requests = setup();
    await userEvent.type(screen.getByLabelText(/date/i), '2027-04-01');
    await chooseStart();
    await userEvent.click(screen.getByRole('button', { name: /create day/i }));

    expect(await screen.findByText('The day screen')).toBeInTheDocument();
    expect(
      requests.find((r) => r.method === 'POST' && r.url === '/api/trips/t1/days')!.body,
    ).toEqual({
      date: '2027-04-01',
      start: { lat: 35.695, lng: 139.702 },
      end: { lat: 35.695, lng: 139.702 },
      startName: 'Hotel Gracery',
      endName: 'Hotel Gracery',
      startTime: 540,
      travelMode: 'walking',
    });
  });

  it('can end somewhere else, start later, and go by car', async () => {
    const requests = setup();
    await userEvent.type(screen.getByLabelText(/date/i), '2027-04-02');
    await chooseStart();
    await userEvent.click(screen.getByLabelText(/ends where it starts/i));
    await userEvent.type(screen.getByLabelText(/where does the day end/i), 'ueno');
    await userEvent.click(await screen.findByRole('button', { name: /Ueno Station/ }));
    const time = screen.getByLabelText(/start time/i);
    await userEvent.clear(time);
    await userEvent.type(time, '10:30');
    await userEvent.click(screen.getByRole('radio', { name: 'Driving' }));
    await userEvent.click(screen.getByRole('button', { name: /create day/i }));

    await screen.findByText('The day screen');
    expect(
      requests.find((r) => r.method === 'POST' && r.url === '/api/trips/t1/days')!.body,
    ).toEqual({
      date: '2027-04-02',
      start: { lat: 35.695, lng: 139.702 },
      end: { lat: 35.713, lng: 139.777 },
      startName: 'Hotel Gracery',
      endName: 'Ueno Station',
      startTime: 630,
      travelMode: 'driving',
    });
  });

  it('asks for a date and a start before it creates anything', async () => {
    const requests = setup();

    await userEvent.click(screen.getByRole('button', { name: /create day/i }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/choose a date/i);
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/choose where the day starts/i);
    expect(requests.filter((r) => r.method === 'POST' && r.url.includes('/days'))).toHaveLength(0);
  });

  it('says so when the day could not be created', async () => {
    setup(() => json(500, { error: { code: 'internal', message: 'x' } }));
    await userEvent.type(screen.getByLabelText(/date/i), '2027-04-01');
    await chooseStart();

    await userEvent.click(screen.getByRole('button', { name: /create day/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create the day/i);
  });

  it('lets you change the start you chose', async () => {
    setup();
    await chooseStart();

    await userEvent.click(screen.getByRole('button', { name: /change start/i }));

    expect(screen.getByLabelText(/where does the day start/i)).toBeInTheDocument();
  });
});
