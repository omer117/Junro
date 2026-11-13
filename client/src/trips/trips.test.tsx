import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardingPass } from './BoardingPass';
import { DayCard } from './DayCard';
import { TripsHome } from './TripsHome';
import type { Day, Trip } from './types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const trip: Trip = { id: 't1', name: 'Japan', createdAt: '2026-11-01T10:00:00Z' };
const day = (over: Partial<Day> = {}): Day => ({
  id: 'd1',
  tripId: 't1',
  date: '2027-04-01',
  start: { lat: 1, lng: 1 },
  end: { lat: 1, lng: 1 },
  startTime: 540,
  travelMode: 'walking',
  stageCount: 5,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('BoardingPass', () => {
  it('shows the trip, its first day, how many days are planned and the countdown', () => {
    const days = [day({ date: '2027-04-03' }), day({ id: 'd2', date: '2027-04-01' })];

    render(<BoardingPass trip={trip} days={days} today="2026-11-13" />);

    expect(screen.getByRole('heading', { name: 'Japan' })).toBeInTheDocument();
    expect(screen.getByText(/boarding pass/i)).toBeInTheDocument();
    expect(screen.getByText('Thu, Apr 1')).toBeInTheDocument(); // the earliest day, not the first listed
    expect(screen.getByText('139 days')).toBeInTheDocument();
    expect(screen.getByText(/2 days planned/i)).toBeInTheDocument();
  });

  it('says "1 day" and "Today" in the singular and on the day', () => {
    const { rerender } = render(
      <BoardingPass trip={trip} days={[day({ date: '2026-11-14' })]} today="2026-11-13" />,
    );
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.getByText(/1 day planned/i)).toBeInTheDocument();

    rerender(<BoardingPass trip={trip} days={[day({ date: '2026-11-13' })]} today="2026-11-13" />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('does not invent a countdown when there are no days, or when the trip has started', () => {
    const { rerender } = render(<BoardingPass trip={trip} days={[]} today="2026-11-13" />);
    expect(screen.getByText(/no days yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/days$/)).toBeNull();

    rerender(<BoardingPass trip={trip} days={[day({ date: '2026-11-01' })]} today="2026-11-13" />);
    expect(screen.getByText(/under way/i)).toBeInTheDocument();
  });
});

describe('DayCard', () => {
  const renderCard = (d: Day) =>
    render(
      <MemoryRouter>
        <DayCard day={d} />
      </MemoryRouter>,
    );

  it('is a link to the day, with its date, number of stops and travel mode', () => {
    renderCard(day());

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/days/d1');
    expect(link).toHaveTextContent('Thu, Apr 1');
    expect(link).toHaveTextContent('5 stops · walking');
    expect(link).toHaveTextContent('Apr');
    expect(link).toHaveTextContent('01');
  });

  it('uses the singular for one stop', () => {
    renderCard(day({ stageCount: 1, travelMode: 'driving' }));

    expect(screen.getByRole('link')).toHaveTextContent('1 stop · driving');
  });

  it('invites you to plan a day that has no stops yet', () => {
    renderCard(day({ stageCount: 0 }));

    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(/plan this day/i);
    expect(link).toHaveClass('day-card--empty');
  });
});

/** A fake server for the trips home screen. */
function serverWith(options: { trips: Trip[]; days?: Record<string, Day[]>; user?: object }) {
  const calls: string[] = [];
  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url === '/api/auth/me') {
      return json(200, options.user ?? { id: 'u1', email: 'ann@x.com', name: 'Ann Lee' });
    }
    if (url === '/api/trips' && method === 'GET') return json(200, options.trips);
    if (url === '/api/trips' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return json(201, { id: 'new', name: body.name, createdAt: '2026-11-13T00:00:00Z' });
    }
    const days = /^\/api\/trips\/([^/]+)\/days$/.exec(url);
    if (days) return json(200, options.days?.[days[1]!] ?? []);
    return json(404, { error: { code: 'not_found', message: 'Not found' } });
  });
  vi.stubGlobal('fetch', stub);
  return { calls };
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TripsHome today="2026-11-13" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TripsHome', () => {
  it('shows the latest trip as a boarding pass with its days', async () => {
    serverWith({
      trips: [trip, { id: 't0', name: 'Old trip', createdAt: '2026-01-01T00:00:00Z' }],
      days: {
        t1: [day(), day({ id: 'd2', date: '2027-04-02', stageCount: 0 })],
      },
    });

    renderHome();

    expect(await screen.findByRole('heading', { name: 'Japan' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: /your days/i });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText(/1 of 2 days planned/i)).toBeInTheDocument();
  });

  it('switches to another trip', async () => {
    serverWith({
      trips: [trip, { id: 't0', name: 'Old trip', createdAt: '2026-01-01T00:00:00Z' }],
      days: { t0: [day({ id: 'dx', tripId: 't0', date: '2026-02-01' })] },
    });
    renderHome();

    await userEvent.selectOptions(await screen.findByLabelText('Trip'), 'Old trip');

    expect(await screen.findByRole('heading', { name: 'Old trip' })).toBeInTheDocument();
    expect(screen.getAllByText('Sun, Feb 1').length).toBeGreaterThan(0); // pass and day card
  });

  it('welcomes someone with no trips, and creates the first one', async () => {
    const { calls } = serverWith({ trips: [] });
    renderHome();

    expect(
      await screen.findByRole('heading', { name: /plan your first trip/i }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/trip name/i), '  Japan  ');
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    expect(calls).toContain('POST /api/trips');
    const post = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ name: 'Japan' });
  });

  it('will not create a trip without a name', async () => {
    const { calls } = serverWith({ trips: [] });
    renderHome();

    await userEvent.click(await screen.findByRole('button', { name: /create trip/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/give your trip a name/i);
    expect(calls).not.toContain('POST /api/trips');
  });

  it('offers to add a day, and links to where that happens', async () => {
    serverWith({ trips: [trip], days: { t1: [] } });
    renderHome();

    const add = await screen.findByRole('link', { name: /add a day/i });

    expect(add).toHaveAttribute('href', '/trips/t1/days/new');
  });

  it('has an account menu with the person and a way out', async () => {
    serverWith({ trips: [trip] });
    renderHome();

    expect(await screen.findByText('A')).toBeInTheDocument(); // the initial in the avatar
    await userEvent.click(screen.getByRole('button', { name: /account/i }));
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('says so, with a way to retry, when the trips cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/auth/me'
          ? json(200, { id: 'u1', email: 'a@x.com', name: 'Ann' })
          : json(500, { error: { code: 'internal', message: 'Something went wrong' } }),
      ),
    );
    renderHome();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your trips/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
