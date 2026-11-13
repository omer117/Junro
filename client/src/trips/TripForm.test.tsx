import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardingPass } from './BoardingPass';
import { TripForm } from './TripForm';
import type { Trip } from './types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TLV = {
  iata: 'TLV',
  name: 'Ben Gurion International Airport',
  city: 'Tel Aviv',
  countryCode: 'IL',
  countryName: 'Israel',
};
const HND = {
  iata: 'HND',
  name: 'Tokyo Haneda International Airport',
  city: 'Tokyo',
  countryCode: 'JP',
  countryName: 'Japan',
};

afterEach(() => vi.unstubAllGlobals());

function server(handlers: Record<string, (init?: RequestInit) => Response>) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/airports')) {
        const q = new URL(url, 'http://x').searchParams.get('q')!.toLowerCase();
        return json(
          200,
          [TLV, HND].filter((a) => a.city.toLowerCase().startsWith(q.slice(0, 3))),
        );
      }
      return (
        handlers[`${method} ${url}`] ??
        (() => json(404, { error: { code: 'not_found', message: 'x' } }))
      )(init);
    }),
  );
  return requests;
}

function renderForm(props: Partial<Parameters<typeof TripForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TripForm onDone={onDone} {...props} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('TripForm (new trip)', () => {
  it('creates a trip with a name and the two airports', async () => {
    const requests = server({
      'POST /api/trips': () =>
        json(201, { id: 'new', name: 'Japan', createdAt: 'x', origin: TLV, destination: HND }),
    });
    const onDone = renderForm();

    await userEvent.type(screen.getByLabelText(/trip name/i), 'Japan');
    await userEvent.type(screen.getByLabelText('From'), 'tel');
    await userEvent.click(await screen.findByRole('button', { name: /TLV/ }));
    await userEvent.type(screen.getByLabelText('To'), 'tok');
    await userEvent.click(await screen.findByRole('button', { name: /HND/ }));
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.body).toEqual({ name: 'Japan', originAirport: 'TLV', destinationAirport: 'HND' });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('creates a trip with only a name, leaving the airports out', async () => {
    const requests = server({
      'POST /api/trips': () =>
        json(201, { id: 'new', name: 'Japan', createdAt: 'x', origin: null, destination: null }),
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(/trip name/i), 'Japan');
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true));
    expect(requests.find((r) => r.method === 'POST')!.body).toEqual({ name: 'Japan' });
  });

  it('asks for a name', async () => {
    const requests = server({});
    renderForm();

    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/give your trip a name/i);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('explains when the server refuses the same airport twice', async () => {
    server({
      'POST /api/trips': () =>
        json(400, {
          error: { code: 'same_airport', message: 'The origin and the destination must differ.' },
        }),
    });
    renderForm();

    await userEvent.type(screen.getByLabelText(/trip name/i), 'Japan');
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must differ/i);
  });
});

describe('TripForm (editing a trip)', () => {
  const trip: Trip = { id: 't1', name: 'Japan', createdAt: 'x', origin: TLV, destination: null };

  it('starts with the trip as it is, and saves only the change', async () => {
    const requests = server({
      'PATCH /api/trips/t1': () => json(200, { ...trip, destination: HND }),
    });
    const onDone = renderForm({ trip });

    expect(screen.getByLabelText(/trip name/i)).toHaveValue('Japan');
    expect(screen.getByText('TLV')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('To'), 'tok');
    await userEvent.click(await screen.findByRole('button', { name: /HND/ }));
    await userEvent.click(screen.getByRole('button', { name: /save trip/i }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(requests.find((r) => r.method === 'PATCH')!.body).toEqual({
      name: 'Japan',
      originAirport: 'TLV',
      destinationAirport: 'HND',
    });
  });

  it('clears an airport that was removed', async () => {
    const requests = server({ 'PATCH /api/trips/t1': () => json(200, { ...trip, origin: null }) });
    renderForm({ trip });

    await userEvent.click(screen.getByRole('button', { name: /remove from airport/i }));
    await userEvent.click(screen.getByRole('button', { name: /save trip/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true));
    expect(requests.find((r) => r.method === 'PATCH')!.body).toMatchObject({ originAirport: null });
  });
});

describe('BoardingPass with a route', () => {
  const today = '2026-11-13';

  it('shows the two airport codes with their cities', () => {
    render(
      <BoardingPass
        trip={{ id: 't', name: 'Japan', createdAt: 'x', origin: TLV, destination: HND }}
        days={[]}
        today={today}
      />,
    );

    expect(screen.getByText('TLV')).toBeInTheDocument();
    expect(screen.getByText('HND')).toBeInTheDocument();
    expect(screen.getByText('Tel Aviv')).toBeInTheDocument();
    expect(screen.getByText('Tokyo')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /from tel aviv to tokyo/i })).toBeInTheDocument();
  });

  it('shows no route when one of the airports is missing', () => {
    render(
      <BoardingPass
        trip={{ id: 't', name: 'Japan', createdAt: 'x', origin: TLV, destination: null }}
        days={[]}
        today={today}
      />,
    );

    expect(screen.queryByText('TLV')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Japan' })).toBeInTheDocument();
  });
});
