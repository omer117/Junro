import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { selectAirports, type RawAirport } from './select';

let counter = 0;
function airport(over: Partial<RawAirport> & { iata: string; country: string }): RawAirport {
  counter += 1;
  return {
    type: 'large_airport',
    name: `Airport ${over.iata}`,
    municipality: 'Somewhere',
    lat: 10,
    lng: 20 + counter / 1000,
    icao: `X${over.iata}`,
    scheduledService: true,
    ...over,
  };
}

const routes = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('selectAirports', () => {
  it('takes the busiest airport of every country first, even when the target is small', () => {
    const raw = [
      airport({ iata: 'AAA', country: 'US' }),
      airport({ iata: 'BBB', country: 'US' }),
      airport({ iata: 'CCC', country: 'FR' }),
      airport({ iata: 'DDD', country: 'IS', type: 'medium_airport' }),
    ];

    const { airports } = selectAirports(raw, routes({ AAA: 50, BBB: 500, CCC: 10, DDD: 2 }), {
      target: 3,
      countries: ['US', 'FR', 'IS'],
    });

    expect(airports.map((a) => a.iata).sort()).toEqual(['BBB', 'CCC', 'DDD']);
  });

  it('fills the remaining places with the busiest airports anywhere', () => {
    const raw = [
      airport({ iata: 'AAA', country: 'US' }),
      airport({ iata: 'BBB', country: 'US' }),
      airport({ iata: 'CCC', country: 'US' }),
      airport({ iata: 'DDD', country: 'FR' }),
    ];

    const { airports } = selectAirports(raw, routes({ AAA: 30, BBB: 90, CCC: 60, DDD: 5 }), {
      target: 3,
      countries: ['US', 'FR'],
    });

    // One per country (BBB, DDD), then the best of what is left (CCC).
    expect(airports.map((a) => a.iata).sort()).toEqual(['BBB', 'CCC', 'DDD']);
  });

  it('ranks the result from the biggest and busiest, starting at 1', () => {
    const raw = [
      airport({ iata: 'SML', country: 'VU', type: 'small_airport' }),
      airport({ iata: 'MED', country: 'FR', type: 'medium_airport' }),
      airport({ iata: 'BIG', country: 'US' }),
      airport({ iata: 'BUS', country: 'US' }),
    ];

    const { airports } = selectAirports(raw, routes({ SML: 9999, MED: 400, BIG: 100, BUS: 300 }), {
      target: 10,
      countries: ['VU', 'FR', 'US'],
    });

    // Large before medium before small; within a size, more routes first.
    expect(airports.map((a) => [a.rank, a.iata])).toEqual([
      [1, 'BUS'],
      [2, 'BIG'],
      [3, 'MED'],
      [4, 'SML'],
    ]);
  });

  it('breaks ties by name, so the same input always gives the same list', () => {
    const raw = [
      airport({ iata: 'ZZZ', country: 'US', name: 'Zulu Field' }),
      airport({ iata: 'AAA', country: 'US', name: 'Alpha Field' }),
    ];

    const { airports } = selectAirports(raw, routes({}), { target: 5, countries: ['US'] });

    expect(airports.map((a) => a.iata)).toEqual(['AAA', 'ZZZ']);
  });

  it.each([
    ['no IATA code', { iata: '' }],
    ['a four-letter code', { iata: 'ABCD' }],
    ['no scheduled flights', { scheduledService: false }],
    ['a heliport', { type: 'heliport' }],
    ['a closed airport', { type: 'closed' }],
    ['a seaplane base', { type: 'seaplane_base' }],
  ])('ignores an airport with %s', (_name, change) => {
    const raw = [
      airport({ iata: 'GOOD', country: 'US' }),
      airport({ iata: 'XYZ', country: 'US', ...change }),
    ].map((a) => (a.iata === 'GOOD' ? { ...a, iata: 'GDX' } : a));

    const { airports } = selectAirports(raw, routes({}), { target: 10, countries: ['US'] });

    expect(airports.map((a) => a.iata)).toEqual(['GDX']);
  });

  it('uses a small airport only when it is all a country has', () => {
    const raw = [
      airport({ iata: 'SMA', country: 'NR', type: 'small_airport' }),
      airport({ iata: 'LGA', country: 'US' }),
      airport({ iata: 'SMB', country: 'US', type: 'small_airport' }),
    ];

    const { airports } = selectAirports(raw, routes({ SMA: 1, SMB: 900 }), {
      target: 2,
      countries: ['NR', 'US'],
    });

    expect(airports.map((a) => a.iata).sort()).toEqual(['LGA', 'SMA']);
  });

  it('says which countries have no airport to offer, instead of hiding it', () => {
    const raw = [airport({ iata: 'AAA', country: 'US' })];

    const result = selectAirports(raw, routes({}), { target: 5, countries: ['US', 'VA', 'MC'] });

    expect(result.countriesWithout).toEqual(['VA', 'MC']);
  });

  it('keeps every country even when that is more than the target', () => {
    const raw = ['AAA', 'BBB', 'CCC', 'DDD'].map((iata, i) =>
      airport({ iata, country: ['US', 'FR', 'JP', 'IL'][i]! }),
    );

    const { airports } = selectAirports(raw, routes({}), {
      target: 2,
      countries: ['US', 'FR', 'JP', 'IL'],
    });

    expect(airports).toHaveLength(4);
  });

  it('fills the fields the app needs', () => {
    const raw = [
      airport({
        iata: 'TLV',
        country: 'IL',
        name: 'Ben Gurion International Airport',
        municipality: 'Tel Aviv',
        icao: 'LLBG',
        lat: 32.0114,
        lng: 34.8867,
      }),
    ];

    const { airports } = selectAirports(raw, routes({}), {
      target: 1,
      countries: ['IL'],
      countryNames: { IL: 'Israel' },
    });

    expect(airports[0]).toEqual({
      iata: 'TLV',
      icao: 'LLBG',
      name: 'Ben Gurion International Airport',
      city: 'Tel Aviv',
      countryCode: 'IL',
      countryName: 'Israel',
      lat: 32.0114,
      lng: 34.8867,
      rank: 1,
    });
  });
});

describe('parseCsv', () => {
  it('reads quoted fields, commas inside quotes and doubled quotes', () => {
    const rows = parseCsv('"id","name","note"\n1,"Tokyo, Japan","say ""hi"""\n2,Plain,\n');

    expect(rows).toEqual([
      { id: '1', name: 'Tokyo, Japan', note: 'say "hi"' },
      { id: '2', name: 'Plain', note: '' },
    ]);
  });

  it('copes with Windows line endings and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });
});
