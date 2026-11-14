import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoardingPass } from './BoardingPass';
import type { Trip } from './types';

const airport = (iata: string, city: string) => ({
  iata,
  name: `${city} Airport`,
  city,
  countryCode: 'XX',
  countryName: 'Somewhere',
});

const trip: Trip = {
  id: 't1',
  name: 'Big in Japan',
  createdAt: '2027-01-01T00:00:00Z',
  origin: airport('TLV', 'Tel Aviv'),
  destination: airport('HND', 'Tokyo'),
};

describe('BoardingPass', () => {
  it('draws the flight as a dashed line with a small plane going from one airport to the other', () => {
    render(<BoardingPass trip={trip} days={[]} today="2027-01-02" />);

    const route = screen.getByRole('img', { name: 'From Tel Aviv to Tokyo' });
    const flight = route.querySelector('.boarding-pass__flight');

    expect(flight).not.toBeNull();
    expect(flight?.querySelector('svg.boarding-pass__plane')).not.toBeNull();
    // Decoration only: the screen reader already hears "From Tel Aviv to Tokyo".
    expect(flight).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no flight line when the airports are not chosen', () => {
    render(<BoardingPass trip={{ ...trip, origin: null }} days={[]} today="2027-01-02" />);

    expect(document.querySelector('.boarding-pass__flight')).toBeNull();
  });
});
