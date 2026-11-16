import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Landing } from './Landing';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function renderLanding(options: { providers?: string[] | 'error'; url?: string } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/providers') {
        return options.providers === 'error'
          ? json(500, { error: { code: 'x', message: 'x' } })
          : json(200, { providers: options.providers ?? ['google'] });
      }
      return json(404, { error: { code: 'not_found', message: 'x' } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.url ?? '/']}>
        <Landing />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Landing', () => {
  it('says what Junro is in one clear heading', () => {
    renderLanding();

    expect(
      screen.getByRole('heading', { level: 1, name: /your trip, in the right order/i }),
    ).toBeInTheDocument();
  });

  it('opens the sign-in choices from the header and from every "Plan a trip" button', async () => {
    renderLanding();

    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    const dialog = await screen.findByRole('dialog', { name: /sign in to junro/i });
    expect(within(dialog).getByRole('link', { name: /continue with google/i })).toHaveAttribute(
      'href',
      '/api/auth/google',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const plans = screen.getAllByRole('button', { name: /plan a trip/i });
    expect(plans.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(plans[0]!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('offers one button for each provider the server has set up, in the same order', async () => {
    renderLanding({ providers: ['google', 'github', 'microsoft'] });

    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    const list = await screen.findByRole('list', { name: /ways to sign in/i });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Continue with Google',
      'Continue with GitHub',
      'Continue with Microsoft',
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/api/auth/google',
      '/api/auth/github',
      '/api/auth/microsoft',
    ]);
  });

  it('still offers Google when the list of providers cannot be read', async () => {
    renderLanding({ providers: 'error' });

    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('link', { name: /continue with google/i })).toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens by itself with a warning in words when sign-in came back refused', async () => {
    renderLanding({ url: '/?signin=failed&reason=email_in_use' });

    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      /already has a Junro account.*connect this one in Settings/i,
    );
  });

  it.each([
    ['cancelled', /cancelled/i],
    ['no_verified_email', /verified email/i],
    ['', /did not work/i],
  ])('explains the reason "%s"', async (reason, text) => {
    renderLanding({ url: `/?signin=failed${reason ? `&reason=${reason}` : ''}` });

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('says that signing in with the same email links the accounts', async () => {
    renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/same email links your accounts/i)).toBeInTheDocument();
  });

  it('has a "how it works" link that jumps to the three steps', () => {
    renderLanding();

    const nav = screen.getByRole('navigation');
    const link = within(nav).getByRole('link', { name: /how it works/i });
    expect(link).toHaveAttribute('href', '#how-it-works');
    expect(document.getElementById('how-it-works')).not.toBeNull();
    expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute(
      'href',
      '#how-it-works',
    );
  });

  it('explains the three steps in order', () => {
    renderLanding();

    const steps = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(steps).toEqual(['Lay out your days', 'Drop in places', 'Find my route']);
    expect(
      screen.getByRole('heading', { level: 2, name: /three steps, then go/i }),
    ).toBeInTheDocument();
  });

  it('tells the story of the name, with the Japanese marked as Japanese', () => {
    renderLanding();

    expect(screen.getByRole('heading', { level: 2, name: /why junro/i })).toBeInTheDocument();
    const japanese = document.querySelectorAll('[lang="ja"]');
    expect(japanese.length).toBeGreaterThanOrEqual(1);
    expect(Array.from(japanese).some((el) => el.textContent?.includes('順路'))).toBe(true);
  });

  it('keeps the sample illustration out of the reading order', () => {
    const { container } = renderLanding();

    const art = container.querySelector('[data-testid="landing-art"]');
    expect(art).toHaveAttribute('aria-hidden', 'true');
  });

  it('ends with a call to action', () => {
    renderLanding();

    expect(screen.getByText(/takeoff is closer than you think/i)).toBeInTheDocument();
  });
});
