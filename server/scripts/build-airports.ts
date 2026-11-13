/**
 * Builds server/data/airports.json: about 300 of the world's biggest and busiest airports,
 * with at least one for every country that has a passenger airport.
 *
 * Run it when the list should be refreshed:   npx tsx scripts/build-airports.ts
 *
 * Sources (see the README for credits and licences):
 *   - OurAirports (public domain): airports and countries, https://ourairports.com/data/
 *   - OpenFlights routes (Open Database Licence): used only to count how many routes touch an
 *     airport, as a measure of how busy it is. The data is from 2014, so airports opened since
 *     then (Berlin BER, Istanbul IST...) look quieter than they are; the size class from
 *     OurAirports keeps the big ones near the top.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../src/airports/csv.js';
import { selectAirports, type RawAirport } from '../src/airports/select.js';

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';
const ROUTES = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat';
const TARGET = 300;

async function download(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status}`);
  return response.text();
}

const [airportsCsv, countriesCsv, routesDat] = await Promise.all([
  download(`${OURAIRPORTS}/airports.csv`),
  download(`${OURAIRPORTS}/countries.csv`),
  download(ROUTES),
]);

const raw: RawAirport[] = parseCsv(airportsCsv).map((row) => ({
  type: row.type ?? '',
  name: row.name ?? '',
  municipality: row.municipality ?? '',
  country: row.iso_country ?? '',
  lat: Number(row.latitude_deg),
  lng: Number(row.longitude_deg),
  iata: row.iata_code ?? '',
  icao: row.icao_code ?? '',
  scheduledService: row.scheduled_service === 'yes',
}));

const countries = parseCsv(countriesCsv);
const countryNames = Object.fromEntries(countries.map((c) => [c.code!, c.name!]));

// routes.dat: airline, airline id, source, source id, destination, destination id, ...
const routeCounts = new Map<string, number>();
for (const line of routesDat.split('\n')) {
  const fields = line.split(',');
  for (const code of [fields[2], fields[4]]) {
    if (code && /^[A-Z]{3}$/.test(code)) routeCounts.set(code, (routeCounts.get(code) ?? 0) + 1);
  }
}

const { airports, countriesWithout } = selectAirports(raw, routeCounts, {
  target: TARGET,
  countries: Object.keys(countryNames),
  countryNames,
});

writeFileSync(
  join(import.meta.dirname, '../data/airports.json'),
  JSON.stringify(airports, null, 1) + '\n',
);

const covered = new Set(airports.map((a) => a.countryCode));
console.log(`Wrote ${airports.length} airports covering ${covered.size} countries.`);
console.log(`Countries without a passenger airport (${countriesWithout.length}):`);
console.log(countriesWithout.map((code) => `${code} ${countryNames[code]}`).join(', '));
console.log(
  'Top 10:',
  airports
    .slice(0, 10)
    .map((a) => a.iata)
    .join(' '),
);
