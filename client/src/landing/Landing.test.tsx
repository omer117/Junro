import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

describe('Landing', () => {
  it('says what Junro is in one clear heading', () => {
    render(<Landing />);

    expect(
      screen.getByRole('heading', { level: 1, name: /your trip, in the right order/i }),
    ).toBeInTheDocument();
  });

  it('lets people sign in from the header, and start from the page', () => {
    render(<Landing />);

    const signIn = screen.getByRole('link', { name: /^sign in$/i });
    expect(signIn).toHaveAttribute('href', '/api/auth/google');
    for (const plan of screen.getAllByRole('link', { name: /plan a trip/i })) {
      expect(plan).toHaveAttribute('href', '/api/auth/google');
    }
    expect(screen.getAllByRole('link', { name: /plan a trip/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('has a "how it works" link that jumps to the three steps', () => {
    render(<Landing />);

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
    render(<Landing />);

    const steps = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(steps).toEqual(['Lay out your days', 'Drop in places', 'Find my route']);
    expect(
      screen.getByRole('heading', { level: 2, name: /three steps, then go/i }),
    ).toBeInTheDocument();
  });

  it('tells the story of the name, with the Japanese marked as Japanese', () => {
    render(<Landing />);

    expect(screen.getByRole('heading', { level: 2, name: /why junro/i })).toBeInTheDocument();
    const japanese = document.querySelectorAll('[lang="ja"]');
    expect(japanese.length).toBeGreaterThanOrEqual(1);
    expect(Array.from(japanese).some((el) => el.textContent?.includes('順路'))).toBe(true);
  });

  it('keeps the sample illustration out of the reading order', () => {
    const { container } = render(<Landing />);

    const art = container.querySelector('[data-testid="landing-art"]');
    expect(art).toHaveAttribute('aria-hidden', 'true');
  });

  it('ends with a call to action', () => {
    render(<Landing />);

    expect(screen.getByText(/takeoff is closer than you think/i)).toBeInTheDocument();
  });
});
