import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewStayPage } from './NewStayPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const hotel = {
  id: 'ph',
  googlePlaceId: 'ChIJ-hotel-000001',
  name: 'Hotel Gracery',
  lat: 35.695,
  lng: 139.702,
};

afterEach(() => vi.unstubAllGlobals());

function setup(create: () => Response = () => json(201, { id: 'newstay' })) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/places/search')) {
        return json(200, [{ googlePlaceId: hotel.googlePlaceId, text: 'Hotel Gracery Shinjuku' }]);
      }
      if (url === '/api/places' && method === 'POST') return json(201, hotel);
      if (url === '/api/trips/t1/segments' && method === 'POST') return create();
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/trips/t1/stays/new']}>
        <Routes>
          <Route path="/trips/:tripId/stays/new" element={<NewStayPage />} />
          <Route path="/segments/:stayId" element={<p>The stay screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return requests;
}

async function fillIn(name: string) {
  await userEvent.type(screen.getByLabelText('City or name'), name);
  await userEvent.type(screen.getByLabelText(/where are you staying/i), 'hotel');
  await userEvent.click(await screen.findByRole('button', { name: /Hotel Gracery/ }));
  await userEvent.type(screen.getByLabelText('First day'), '2027-04-01');
}

describe('NewStayPage', () => {
  it('creates a stay with its hotel, dates and number of days, and opens it', async () => {
    const requests = setup();
    await fillIn('Tokyo');
    await userEvent.click(screen.getByRole('button', { name: /create stay/i }));

    expect(await screen.findByText('The stay screen')).toBeInTheDocument();
    expect(requests.find((r) => r.url === '/api/trips/t1/segments')!.body).toEqual({
      name: 'Tokyo',
      firstDate: '2027-04-01',
      dayCount: 3,
      hotel: { lat: 35.695, lng: 139.702 },
      hotelName: 'Hotel Gracery',
      hotelPlaceId: 'ChIJ-hotel-000001',
      travelMode: 'walking',
      startTime: 540,
    });
  });

  it('says what is missing instead of sending', async () => {
    const requests = setup();

    await userEvent.click(screen.getByRole('button', { name: /create stay/i }));

    expect(screen.getByText('Give the stay a name, for example the city.')).toBeInTheDocument();
    expect(screen.getByText('Choose your hotel.')).toBeInTheDocument();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('explains a date clash with another stay', async () => {
    setup(() =>
      json(409, { error: { code: 'segment_overlap', message: 'Another stay uses these dates' } }),
    );
    await fillIn('Kyoto');
    await userEvent.click(screen.getByRole('button', { name: /create stay/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already uses some of these dates/i);
  });
});
