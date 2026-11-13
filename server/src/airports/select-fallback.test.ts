import { describe, expect, it } from 'vitest';
import { selectAirports, type RawAirport } from './select';

const base: RawAirport = {
  type: 'large_airport',
  name: 'Some Airport',
  municipality: 'City',
  country: 'US',
  lat: 1,
  lng: 2,
  iata: 'AAA',
  icao: 'KAAA',
  scheduledService: true,
};

describe('a country whose airports have no scheduled flights right now', () => {
  it('still gets its biggest airport, so it is not missing from the list', () => {
    // For example a country whose airports are closed because of war.
    const raw: RawAirport[] = [
      base,
      { ...base, iata: 'KBP', country: 'UA', name: 'Boryspil', scheduledService: false },
      {
        ...base,
        iata: 'SML',
        country: 'UA',
        name: 'Small field',
        type: 'small_airport',
        scheduledService: false,
      },
    ];

    const { airports, countriesWithout } = selectAirports(raw, new Map(), {
      target: 5,
      countries: ['US', 'UA'],
    });

    expect(airports.map((a) => a.iata).sort()).toEqual(['AAA', 'KBP']);
    expect(countriesWithout).toEqual([]);
  });

  it("prefers a country's airports with scheduled flights when it has some", () => {
    const raw: RawAirport[] = [
      { ...base, iata: 'BIG', country: 'FR', scheduledService: false },
      { ...base, iata: 'OPN', country: 'FR', type: 'medium_airport', scheduledService: true },
    ];

    const { airports } = selectAirports(raw, new Map(), { target: 1, countries: ['FR'] });

    expect(airports.map((a) => a.iata)).toEqual(['OPN']);
  });

  it('does not use the fallback to fill the general places, only to cover a country', () => {
    const raw: RawAirport[] = [
      base,
      { ...base, iata: 'CLS', country: 'US', scheduledService: false },
    ];

    const { airports } = selectAirports(raw, new Map(), { target: 5, countries: ['US'] });

    expect(airports.map((a) => a.iata)).toEqual(['AAA']);
  });

  it('still ignores heliports and airports without a code', () => {
    const raw: RawAirport[] = [
      { ...base, iata: 'HEL', country: 'VA', type: 'heliport', scheduledService: false },
      { ...base, iata: '', country: 'VA', scheduledService: false },
    ];

    const { countriesWithout } = selectAirports(raw, new Map(), { target: 5, countries: ['VA'] });

    expect(countriesWithout).toEqual(['VA']);
  });
});
