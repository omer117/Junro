/** One row of OurAirports, reduced to what the choice needs. */
export interface RawAirport {
  /** OurAirports size class: large_airport, medium_airport, small_airport, heliport, closed... */
  type: string;
  name: string;
  municipality: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  lat: number;
  lng: number;
  iata: string;
  icao: string;
  scheduledService: boolean;
}

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  countryCode: string;
  countryName: string;
  lat: number;
  lng: number;
  /** 1 = the biggest and busiest of the list. */
  rank: number;
}

/** Only real passenger airports: a larger class sorts first. */
const SIZE_ORDER: Record<string, number> = {
  large_airport: 3,
  medium_airport: 2,
  small_airport: 1,
};

export interface SelectOptions {
  /** How many airports to aim for. Covering every country comes first and can exceed this. */
  target: number;
  /** Every country code that should be represented, if it has any airport to offer. */
  countries: string[];
  countryNames?: Record<string, string>;
}

export interface Selection {
  airports: Airport[];
  /** Countries that have no airport with scheduled passenger flights. */
  countriesWithout: string[];
}

/**
 * Chooses the airports Junro offers (for example on the boarding pass).
 *
 * "Biggest and busiest" is: size class first (large, then medium, then small), then the number
 * of flight routes that touch the airport (more is busier), then the name so the result never
 * changes between runs. Two rules shape the list:
 *   1. Every country gets its best airport, so nobody's home airport is missing. A country with
 *      no scheduled flights at the moment still gets its biggest coded airport.
 *   2. The remaining places go to the best airports anywhere.
 */
export function selectAirports(
  raw: RawAirport[],
  routeCounts: Map<string, number>,
  options: SelectOptions,
): Selection {
  const routes = (a: RawAirport) => routeCounts.get(a.iata) ?? 0;
  const better = (a: RawAirport, b: RawAirport) =>
    (SIZE_ORDER[b.type] ?? 0) - (SIZE_ORDER[a.type] ?? 0) ||
    routes(b) - routes(a) ||
    a.name.localeCompare(b.name) ||
    a.iata.localeCompare(b.iata);

  const candidates = raw.filter(
    (a) => /^[A-Z]{3}$/.test(a.iata) && a.scheduledService && a.type in SIZE_ORDER,
  );

  // A code can appear twice in the source; the better row wins.
  const byCode = new Map<string, RawAirport>();
  for (const a of [...candidates].sort(better)) if (!byCode.has(a.iata)) byCode.set(a.iata, a);
  const unique = [...byCode.values()];

  // Rows with a code and a real airport size, even when no scheduled flights run right now
  // (for example airports that are closed because of war). Used only to cover a country.
  const withCode = raw.filter((a) => /^[A-Z]{3}$/.test(a.iata) && a.type in SIZE_ORDER);

  const chosen = new Map<string, RawAirport>();
  const countriesWithout: string[] = [];
  for (const country of options.countries) {
    const best =
      unique.filter((a) => a.country === country).sort(better)[0] ??
      withCode.filter((a) => a.country === country).sort(better)[0];
    if (best) chosen.set(best.iata, best);
    else countriesWithout.push(country);
  }

  for (const a of unique.sort(better)) {
    if (chosen.size >= options.target) break;
    if (!chosen.has(a.iata)) chosen.set(a.iata, a);
  }

  const names = options.countryNames ?? {};
  const airports = [...chosen.values()].sort(better).map((a, index): Airport => ({
    iata: a.iata,
    icao: a.icao,
    name: a.name,
    city: a.municipality,
    countryCode: a.country,
    countryName: names[a.country] ?? a.country,
    lat: a.lat,
    lng: a.lng,
    rank: index + 1,
  }));

  return { airports, countriesWithout };
}
