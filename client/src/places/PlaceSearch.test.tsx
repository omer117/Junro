import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaceSearch } from './PlaceSearch';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const suggestions = [
  { googlePlaceId: 'ChIJ-sensoji-0001', text: 'Senso-ji, Asakusa, Taito City' },
  { googlePlaceId: 'ChIJ-sensoji-0002', text: 'Sensoji Station' },
];
const place = {
  id: 'p1',
  googlePlaceId: 'ChIJ-sensoji-0001',
  name: 'Senso-ji',
  lat: 35.71,
  lng: 139.79,
};

afterEach(() => vi.unstubAllGlobals());

function setup(handlers: { search?: () => Response; create?: () => Response } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/places/search'))
        return (handlers.search ?? (() => json(200, suggestions)))();
      if (url === '/api/places' && method === 'POST')
        return (handlers.create ?? (() => json(201, place)))();
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const onPick = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlaceSearch
        label="Add a stop"
        placeholder="Ramen, temple, bar…"
        onPick={onPick}
        debounceMs={0}
      />
    </QueryClientProvider>,
  );
  return { calls, onPick };
}

describe('PlaceSearch', () => {
  it('searches places as you type and lists the suggestions', async () => {
    const { calls } = setup();

    await userEvent.type(screen.getByLabelText('Add a stop'), 'senso');

    expect(await screen.findByRole('button', { name: /Senso-ji, Asakusa/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sensoji Station/ })).toBeInTheDocument();
    const search = new URL(
      calls.filter((c) => c.url.startsWith('/api/places/search')).at(-1)!.url,
      'http://x',
    );
    expect(search.searchParams.get('q')).toBe('senso');
    expect(search.searchParams.get('sessionToken')).toMatch(/\w{8,}/);
  });

  it('waits for three letters, the least the server accepts, so no search is wasted', async () => {
    const { calls } = setup();

    await userEvent.type(screen.getByLabelText('Add a stop'), 'se');

    expect(calls).toHaveLength(0);
  });

  it('asks the server to save the place when one is chosen, and hands it over', async () => {
    const { calls, onPick } = setup();
    await userEvent.type(screen.getByLabelText('Add a stop'), 'senso');

    await userEvent.click(await screen.findByRole('button', { name: /Senso-ji, Asakusa/ }));

    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith(place));
    const create = calls.find((c) => c.method === 'POST')!;
    expect(create.body).toMatchObject({ googlePlaceId: 'ChIJ-sensoji-0001' });
    expect((create.body as { sessionToken: string }).sessionToken).toMatch(/\w{8,}/);
  });

  it('uses one session token for the search and the choice, and starts no search after the choice', async () => {
    const { calls } = setup();
    await userEvent.type(screen.getByLabelText('Add a stop'), 'senso');
    await userEvent.click(await screen.findByRole('button', { name: /Senso-ji, Asakusa/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));

    const searchTokens = calls
      .filter((c) => c.url.startsWith('/api/places/search'))
      .map((c) => new URL(c.url, 'http://x').searchParams.get('sessionToken'));
    const createToken = (calls.find((c) => c.method === 'POST')!.body as { sessionToken: string })
      .sessionToken;

    // Every search and the choice share one token, so Google bills them as one session.
    expect(new Set(searchTokens)).toEqual(new Set([createToken]));
  });

  it('empties the box after a choice, ready for the next search', async () => {
    setup();
    const box = screen.getByLabelText('Add a stop');
    await userEvent.type(box, 'senso');
    await userEvent.click(await screen.findByRole('button', { name: /Senso-ji, Asakusa/ }));

    await vi.waitFor(() => expect(box).toHaveValue(''));
  });

  it.each([
    ['quota_reached', 429, /monthly limit/i],
    ['rate_limited', 429, /too many searches/i],
    ['google_not_configured', 503, /not available/i],
    ['google_unavailable', 502, /could not search/i],
  ])('explains the server error %s', async (code, status, text) => {
    setup({ search: () => json(status, { error: { code, message: 'x' } }) });

    await userEvent.type(screen.getByLabelText('Add a stop'), 'senso');

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('says so when the place could not be saved', async () => {
    const { onPick } = setup({
      create: () => json(404, { error: { code: 'place_not_found', message: 'x' } }),
    });
    await userEvent.type(screen.getByLabelText('Add a stop'), 'senso');

    await userEvent.click(await screen.findByRole('button', { name: /Senso-ji, Asakusa/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not add that place/i);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('says so when nothing matches', async () => {
    setup({ search: () => json(200, []) });

    await userEvent.type(screen.getByLabelText('Add a stop'), 'zzzzz');

    expect(await screen.findByText(/no places found/i)).toBeInTheDocument();
  });
});
