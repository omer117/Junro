import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AirportPicker } from './AirportPicker';
import type { Airport } from './types';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HND: Airport = {
  iata: 'HND',
  name: 'Tokyo Haneda International Airport',
  city: 'Tokyo',
  countryCode: 'JP',
  countryName: 'Japan',
};
const NRT: Airport = {
  iata: 'NRT',
  name: 'Narita International Airport',
  city: 'Narita',
  countryCode: 'JP',
  countryName: 'Japan',
};

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = null }: { initial?: Airport | null }) {
  const [value, setValue] = useState<Airport | null>(initial);
  return <AirportPicker label="From" value={value} onChange={setValue} debounceMs={0} />;
}

function renderPicker(initial?: Airport | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...(initial !== undefined ? { initial } : {})} />
    </QueryClientProvider>,
  );
}

describe('AirportPicker', () => {
  it('searches as you type and lists airports with their codes', async () => {
    const fetch = vi.fn(async (_url: string) => json(200, [HND, NRT]));
    vi.stubGlobal('fetch', fetch);
    renderPicker();

    await userEvent.type(screen.getByLabelText('From'), 'tok');

    expect(
      await screen.findByRole('button', { name: /HND.*Tokyo Haneda.*Tokyo.*Japan/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /NRT.*Narita/i })).toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/airports?q=tok&limit=6');
  });

  it('does not search for fewer than two letters', async () => {
    const fetch = vi.fn(async () => json(200, []));
    vi.stubGlobal('fetch', fetch);
    renderPicker();

    await userEvent.type(screen.getByLabelText('From'), 't');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('chooses an airport, and shows it with a way to remove it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [HND])),
    );
    renderPicker();
    await userEvent.type(screen.getByLabelText('From'), 'tok');

    await userEvent.click(await screen.findByRole('button', { name: /HND/ }));

    expect(screen.getByText('HND')).toBeInTheDocument();
    expect(screen.getByText(/Tokyo, Japan/)).toBeInTheDocument();
    expect(screen.queryByLabelText('From')).toBeNull(); // the search box gives way to the choice

    await userEvent.click(screen.getByRole('button', { name: /remove from airport/i }));
    expect(screen.getByLabelText('From')).toBeInTheDocument();
  });

  it('starts with an airport that is already chosen', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderPicker(HND);

    expect(screen.getByText('HND')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [])),
    );
    renderPicker();

    await userEvent.type(screen.getByLabelText('From'), 'zzzz');

    expect(await screen.findByText(/no airports found/i)).toBeInTheDocument();
  });

  it('says so when the search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(500, { error: { code: 'internal', message: 'Something went wrong' } }),
      ),
    );
    renderPicker();

    await userEvent.type(screen.getByLabelText('From'), 'tok');

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not search airports/i);
  });
});
