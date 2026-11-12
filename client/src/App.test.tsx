import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('App', () => {
  it('shows the landing page with a real sign-in link when nobody is signed in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(401, { error: { code: 'unauthenticated', message: 'Sign in required' } }),
      ),
    );

    renderApp();

    expect(
      await screen.findByRole('heading', { name: /your trip, in the right order/i }),
    ).toBeInTheDocument();
    const signIn = screen.getAllByRole('link', { name: /sign in/i })[0]!;
    expect(signIn).toHaveAttribute('href', '/api/auth/google');
  });

  it('shows the trips screen for a signed-in user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { id: 'u1', email: 'a@x.com', name: 'Ann Lee' })),
    );

    renderApp();

    expect(await screen.findByRole('heading', { name: /your trips/i })).toBeInTheDocument();
  });

  it('says so, and offers a retry, when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );

    renderApp();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: { code: 'unauthenticated', message: 'x' } })),
    );

    renderApp('/nowhere');

    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
