import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageShell } from '../../layout/PageShell';
import { PALETTES } from '../../styles/palettes';
import { DayCard } from '../DayCard';
import { TripsHome } from '../TripsHome';
import type { Day, Trip } from '../types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const airport = (iata: string, countryCode: string) => ({
  iata,
  name: `${iata} airport`,
  city: iata,
  countryName: countryCode,
  countryCode,
});

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't1',
  name: 'Japan',
  createdAt: '2026-11-01T10:00:00Z',
  ...over,
});

const day = (over: Partial<Day> = {}): Day => ({
  id: 'd1',
  tripId: 't1',
  date: '2027-04-01',
  start: { lat: 1, lng: 1 },
  end: { lat: 1, lng: 1 },
  startTime: 540,
  travelMode: 'walking',
  stageCount: 3,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

function renderHome(trips: Trip[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' });
      if (url === '/api/trips') return json(200, trips);
      if (/\/days$/.test(url)) return json(200, []);
      if (/\/segments$/.test(url)) return json(200, []);
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TripsHome today="2026-11-13" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PageShell with a palette', () => {
  it('puts the three palette colours on the page, so everything below follows', () => {
    const { container } = render(
      <PageShell palette={PALETTES.sakura}>
        <p>content</p>
      </PageShell>,
    );

    const page = container.querySelector<HTMLElement>('.page')!;
    expect(page.style.getPropertyValue('--accent')).toBe(PALETTES.sakura.accent);
    expect(page.style.getPropertyValue('--sky-warm')).toBe(PALETTES.sakura.skyWarm);
    expect(page.style.getPropertyValue('--sky-top')).toBe(PALETTES.sakura.skyTop);
  });

  it('never touches the warning colours', () => {
    const { container } = render(
      <PageShell palette={PALETTES.lavender}>
        <p>content</p>
      </PageShell>,
    );

    const page = container.querySelector<HTMLElement>('.page')!;
    for (const name of ['--warning', '--warning-text', '--on-warning', '--ink', '--ground']) {
      expect(page.style.getPropertyValue(name)).toBe('');
    }
  });

  it('sets nothing without a palette, or for Golden hour (it is already the default)', () => {
    const none = render(<PageShell>x</PageShell>).container.querySelector<HTMLElement>('.page')!;
    const golden = render(
      <PageShell palette={PALETTES['golden-hour']}>x</PageShell>,
    ).container.querySelector<HTMLElement>('.page')!;

    expect(none.getAttribute('style')).toBeNull();
    expect(golden.getAttribute('style')).toBeNull();
  });
});

describe('the trips home takes its colours from the destination country', () => {
  it('a trip to Japan gets the sakura colours', async () => {
    const { container } = renderHome([trip({ destination: airport('HND', 'JP') })]);

    await screen.findByRole('heading', { name: 'Japan' });

    const page = container.querySelector<HTMLElement>('.page')!;
    expect(page.style.getPropertyValue('--accent')).toBe(PALETTES.sakura.accent);
  });

  it('a trip with no destination keeps Golden hour, and sets nothing', async () => {
    const { container } = renderHome([trip()]);

    await screen.findByRole('heading', { name: 'Japan' });

    expect(container.querySelector<HTMLElement>('.page')!.getAttribute('style')).toBeNull();
  });

  it('a country without a palette keeps Golden hour', async () => {
    const { container } = renderHome([trip({ destination: airport('SYD', 'AU') })]);

    await screen.findByRole('heading', { name: 'Japan' });

    expect(container.querySelector<HTMLElement>('.page')!.getAttribute('style')).toBeNull();
  });
});

describe('DayCard', () => {
  it('carries the trip colour into a planned day with an accent edge', () => {
    render(
      <MemoryRouter>
        <DayCard day={day()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link')).toHaveClass('day-card--planned');
  });

  it('keeps an empty day dashed, without the edge', () => {
    render(
      <MemoryRouter>
        <DayCard day={day({ stageCount: 0 })} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link')).not.toHaveClass('day-card--planned');
    expect(screen.getByRole('link')).toHaveClass('day-card--empty');
  });
});
