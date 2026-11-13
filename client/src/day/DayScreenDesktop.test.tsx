import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEngine } from '../map/fakeEngine';
import { MapEngineProvider } from '../map/MapEngineContext';
import { DayScreen } from './DayScreen';
import type { DayDetail } from './types';

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
  stageCount: 0,
};

afterEach(() => vi.unstubAllGlobals());

function render_(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query.includes('min-width'),
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/days/d1') return json(200, day);
      if (url === '/api/days/d1/stages') return json(200, []);
      return json(404, { error: { code: 'no_route', message: 'x' } });
    }),
  );
  const fake = fakeEngine();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
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
  return { fake, container };
}

describe('DayScreen on a computer', () => {
  it('keeps the map clear of the side panel on the left', async () => {
    const { fake } = render_(true);
    await screen.findByRole('heading', { name: 'Thu, Apr 1' });

    await vi.waitFor(() => expect(fake.created[0]?.map.fit).toHaveBeenCalled());
    const padding = fake.created[0]!.map.fit.mock.calls.at(-1)![0];
    expect(padding.left).toBeGreaterThan(400); // the panel is on the left
    expect(padding.bottom).toBeLessThan(100); // nothing covers the bottom
  });

  it('is marked as the wide layout, so the sheet becomes a panel', async () => {
    const { container } = render_(true);
    await screen.findByRole('heading', { name: 'Thu, Apr 1' });

    expect(container.querySelector('.day-screen')).toHaveAttribute('data-layout', 'wide');
  });
});

describe('DayScreen on a phone', () => {
  it('keeps the map clear of the sheet at the bottom', async () => {
    const { fake } = render_(false);
    await screen.findByRole('heading', { name: 'Thu, Apr 1' });

    await vi.waitFor(() => expect(fake.created[0]?.map.fit).toHaveBeenCalled());
    const padding = fake.created[0]!.map.fit.mock.calls.at(-1)![0];
    expect(padding.bottom).toBeGreaterThan(300);
    expect(padding.left).toBeLessThan(100);
  });

  it('is marked as the narrow layout', async () => {
    const { container } = render_(false);
    await screen.findByRole('heading', { name: 'Thu, Apr 1' });

    expect(container.querySelector('.day-screen')).toHaveAttribute('data-layout', 'narrow');
  });
});
