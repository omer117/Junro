import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('signing out', () => {
  it('ends the session on the server and goes back to the landing page', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url === '/api/auth/logout') return new Response(null, { status: 204 });
        return json(200, { id: 'u1', email: 'a@x.com', name: 'Ann Lee' });
      }),
    );
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(
      await screen.findByRole('heading', { name: /your trip, in the right order/i }),
    ).toBeInTheDocument();
    expect(calls).toContain('POST /api/auth/logout');
  });

  it('stays signed in, and says so, when signing out fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/auth/logout'
          ? json(500, { error: { code: 'internal', message: 'Something went wrong' } })
          : json(200, { id: 'u1', email: 'a@x.com', name: 'Ann Lee' }),
      ),
    );
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not sign you out/i);
    expect(screen.getByRole('heading', { name: /your trips/i })).toBeInTheDocument();
  });
});
