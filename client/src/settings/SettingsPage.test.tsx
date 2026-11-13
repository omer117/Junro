import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATEGORIES } from '../categories';
import { SettingsPage } from './SettingsPage';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MINIMUMS: Record<string, number> = {
  restaurant: 45,
  cafe: 20,
  bar: 30,
  temple: 20,
  museum: 45,
  market: 30,
  park: 20,
  shop: 15,
  viewpoint: 10,
  other: 10,
};

const listOf = (preferences: Record<string, number> = {}) =>
  CATEGORIES.map((category) => ({
    category,
    minimumMinutes: MINIMUMS[category]!,
    preferenceMinutes: preferences[category] ?? null,
  }));

afterEach(() => vi.unstubAllGlobals());

function setup(
  options: {
    preferences?: Record<string, number>;
    put?: () => Response;
    list?: () => Response;
  } = {},
) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/me/stay-durations' && method === 'GET') {
        return (options.list ?? (() => json(200, listOf(options.preferences))))();
      }
      if (url.startsWith('/api/me/stay-durations/') && method === 'PUT') {
        return (
          options.put ??
          (() => json(200, { category: 'museum', minimumMinutes: 45, preferenceMinutes: 90 }))
        )();
      }
      if (url.startsWith('/api/me/stay-durations/') && method === 'DELETE')
        return new Response(null, { status: 204 });
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return requests;
}

const row = (name: string) => screen.getByRole('group', { name });

describe('SettingsPage', () => {
  it('lists every category with how long you stay, starting from the default', async () => {
    setup();

    await screen.findAllByRole('group');
    expect(screen.getAllByRole('group')).toHaveLength(CATEGORIES.length);
    expect(within(row('Museum')).getByLabelText(/museum stay in minutes/i)).toHaveValue(45);
    expect(within(row('Museum')).getByText(/shortest: 45 min/i)).toBeInTheDocument();
    expect(within(row('Museum')).getByText(/default/i)).toBeInTheDocument();
  });

  it("shows the person's own choice instead of the default", async () => {
    setup({ preferences: { museum: 120 } });

    await screen.findAllByRole('group');
    expect(within(row('Museum')).getByLabelText(/museum stay in minutes/i)).toHaveValue(120);
    expect(within(row('Museum')).queryByText(/default/i)).toBeNull();
    expect(
      within(row('Museum')).getByRole('button', { name: /reset museum/i }),
    ).toBeInTheDocument();
  });

  it('saves a new stay for one category', async () => {
    const requests = setup();
    const input = await within(
      await screen.findByRole('group', { name: 'Museum' }),
    ).findByLabelText(/museum stay in minutes/i);

    await userEvent.clear(input);
    await userEvent.type(input, '90');
    await userEvent.click(within(row('Museum')).getByRole('button', { name: /save museum/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('/api/me/stay-durations/museum');
    expect(put.body).toEqual({ stayMinutes: 90 });
  });

  it('will not save a stay shorter than the minimum, and says what the minimum is', async () => {
    const requests = setup();
    const input = await within(
      await screen.findByRole('group', { name: 'Museum' }),
    ).findByLabelText(/museum stay in minutes/i);

    await userEvent.clear(input);
    await userEvent.type(input, '10');
    await userEvent.click(within(row('Museum')).getByRole('button', { name: /save museum/i }));

    expect(within(row('Museum')).getByRole('alert')).toHaveTextContent(
      /shortest stay for museum is 45 minutes/i,
    );
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('will not save something that is not a number of minutes', async () => {
    const requests = setup();
    const input = await within(await screen.findByRole('group', { name: 'Park' })).findByLabelText(
      /park stay in minutes/i,
    );

    await userEvent.clear(input);
    await userEvent.click(within(row('Park')).getByRole('button', { name: /save park/i }));

    expect(within(row('Park')).getByRole('alert')).toBeInTheDocument();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('resets a category back to the default', async () => {
    const requests = setup({ preferences: { museum: 120 } });

    await userEvent.click(await screen.findByRole('button', { name: /reset museum/i }));

    await vi.waitFor(() => expect(requests.some((r) => r.method === 'DELETE')).toBe(true));
    expect(requests.find((r) => r.method === 'DELETE')!.url).toBe('/api/me/stay-durations/museum');
  });

  it('says so when saving fails', async () => {
    setup({ put: () => json(500, { error: { code: 'internal', message: 'x' } }) });
    const input = await within(
      await screen.findByRole('group', { name: 'Museum' }),
    ).findByLabelText(/museum stay in minutes/i);
    await userEvent.clear(input);
    await userEvent.type(input, '90');

    await userEvent.click(within(row('Museum')).getByRole('button', { name: /save museum/i }));

    expect(await within(row('Museum')).findByRole('alert')).toHaveTextContent(/could not save/i);
  });

  it('says so, with a retry, when the list cannot be loaded', async () => {
    setup({ list: () => json(500, { error: { code: 'internal', message: 'x' } }) });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load your stay durations/i,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('has a way back', async () => {
    setup();

    expect(await screen.findByRole('link', { name: /back to your trips/i })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
