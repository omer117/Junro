import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInMethods } from '../SignInMethods';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const identity = (id: string, provider: string, email: string) => ({
  id,
  provider,
  email,
  createdAt: '2026-11-01T00:00:00Z',
});

afterEach(() => vi.unstubAllGlobals());

function setup(
  options: {
    identities?: unknown[];
    providers?: string[];
    url?: string;
    remove?: () => Response;
  } = {},
) {
  const requests: Array<{ method: string; url: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url });
      if (url === '/api/auth/identities' && method === 'GET') {
        return json(200, options.identities ?? [identity('i1', 'google', 'ann@example.com')]);
      }
      if (url === '/api/auth/providers') {
        return json(200, { providers: options.providers ?? ['google', 'github', 'microsoft'] });
      }
      if (url.startsWith('/api/auth/identities/') && method === 'DELETE') {
        return (options.remove ?? (() => new Response(null, { status: 204 })))();
      }
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.url ?? '/settings']}>
        <SignInMethods />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return requests;
}

describe('Sign-in methods (Settings)', () => {
  it('lists each way to sign in with its provider and email', async () => {
    setup({
      identities: [
        identity('i1', 'google', 'ann@example.com'),
        identity('i2', 'github', 'ann@work.example'),
      ],
    });

    const list = await screen.findByRole('list', { name: 'Your sign-in methods' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Google');
    expect(rows[0]).toHaveTextContent('ann@example.com');
    expect(rows[1]).toHaveTextContent('GitHub');
    expect(rows[1]).toHaveTextContent('ann@work.example');
  });

  it('offers to connect the providers that are not connected yet, as links that connect', async () => {
    setup();

    expect(await screen.findByRole('link', { name: 'Connect GitHub' })).toHaveAttribute(
      'href',
      '/api/auth/github?link=1',
    );
    expect(screen.getByRole('link', { name: 'Connect Microsoft' })).toHaveAttribute(
      'href',
      '/api/auth/microsoft?link=1',
    );
    expect(screen.queryByRole('link', { name: 'Connect Google' })).not.toBeInTheDocument();
  });

  it('removes one when there are several', async () => {
    const requests = setup({
      identities: [
        identity('i1', 'google', 'ann@example.com'),
        identity('i2', 'github', 'ann@work.example'),
      ],
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Remove GitHub' }));

    await vi.waitFor(() =>
      expect(
        requests.some((r) => r.method === 'DELETE' && r.url === '/api/auth/identities/i2'),
      ).toBe(true),
    );
  });

  it('cannot remove the last one, and says why', async () => {
    setup();

    const button = await screen.findByRole('button', { name: 'Remove Google' });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/only way to sign in/i);
  });

  it('says in words why a connection failed', async () => {
    setup({ url: '/settings?signin=failed&reason=identity_in_use' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already connected to a different Junro account/i,
    );
  });
});
