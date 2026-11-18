import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TripsHome } from '../../trips/TripsHome';
import type { Day } from '../../trips/types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const day = (id: string, date: string, segmentId: string | null): Day => ({
  id,
  tripId: 't1',
  segmentId,
  date,
  start: { lat: 1, lng: 1 },
  end: { lat: 1, lng: 1 },
  startTime: 540,
  travelMode: 'walking',
  stageCount: 0,
});

afterEach(() => vi.unstubAllGlobals());

describe('the trips home with stays', () => {
  it('groups the days of a stay under it, and keeps the other days apart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
        if (url === '/api/trips') {
          return json(200, [{ id: 't1', name: 'Japan', createdAt: '2026-11-01T10:00:00Z' }]);
        }
        if (url === '/api/trips/t1/days') {
          return json(200, [
            day('d1', '2027-04-01', 's1'),
            day('d2', '2027-04-02', 's1'),
            day('d3', '2027-04-20', null),
          ]);
        }
        if (url === '/api/trips/t1/segments') {
          return json(200, [
            {
              id: 's1',
              tripId: 't1',
              name: 'Tokyo',
              hotel: { lat: 1, lng: 1 },
              hotelName: 'Hotel Gracery',
              travelMode: 'walking',
              startTime: 540,
              endTime: null,
              firstDate: '2027-04-01',
              dayCount: 2,
              placeCount: 0,
            },
          ]);
        }
        return json(404, { error: { code: 'not_found', message: 'x' } });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TripsHome today="2026-11-13" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const group = await screen.findByRole('region', { name: 'Stay in Tokyo' });
    expect(within(group).getByText(/2 days · Hotel Gracery/)).toBeInTheDocument();
    expect(within(group).getAllByRole('link', { name: /Apr/ })).toHaveLength(2);
    expect(within(group).getByRole('link', { name: 'Plan this stay' })).toHaveAttribute(
      'href',
      '/segments/s1',
    );
    const loose = screen.getByRole('list', { name: 'Your days' });
    expect(within(loose).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Add a stay' })).toHaveAttribute(
      'href',
      '/trips/t1/stays/new',
    );
  });
});
