import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './AccountMenu';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function setup() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(200, { id: 'u1', email: 'ann@x.com', name: 'Ann Lee' })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <div>
                <AccountMenu />
                <p>Somewhere else on the page</p>
              </div>
            }
          />
          <Route path="/settings" element={<p>The settings page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const open = async () => {
  const button = await screen.findByRole('button', { name: /account/i });
  await userEvent.click(button);
  return button;
};

describe('AccountMenu', () => {
  it('opens and closes with the avatar', async () => {
    setup();
    const button = await open();
    expect(screen.getByText('ann@x.com')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(button);

    expect(screen.queryByText('ann@x.com')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when you click anywhere else on the page', async () => {
    setup();
    await open();

    await userEvent.click(screen.getByText('Somewhere else on the page'));

    expect(screen.queryByText('ann@x.com')).toBeNull();
  });

  it('stays open when you click inside it', async () => {
    setup();
    await open();

    await userEvent.click(screen.getByText('ann@x.com'));

    expect(screen.getByText('ann@x.com')).toBeInTheDocument();
  });

  it('closes with Escape, and puts the focus back on the avatar', async () => {
    setup();
    const button = await open();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByText('ann@x.com')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('closes when you go to Settings', async () => {
    setup();
    await open();

    await userEvent.click(screen.getByRole('link', { name: /settings/i }));

    expect(await screen.findByText('The settings page')).toBeInTheDocument();
    expect(screen.queryByText('ann@x.com')).toBeNull();
  });
});
