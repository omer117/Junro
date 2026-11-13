import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { airports } from '../db/schema.js';
import { testDatabaseUrl } from '../db/test-db.js';
import { loadAirports, seedAirports } from './seed.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(async () => {
  await db.delete(airports);
});
afterAll(() => pool.end());

describe('the airports list (server/data/airports.json)', () => {
  const list = loadAirports();

  it('has about 300 airports with unique IATA codes', () => {
    expect(list.length).toBeGreaterThanOrEqual(300);
    expect(new Set(list.map((a) => a.iata)).size).toBe(list.length);
  });

  it('covers at least 230 countries', () => {
    expect(new Set(list.map((a) => a.countryCode)).size).toBeGreaterThanOrEqual(230);
  });

  it('has every airport complete and valid', () => {
    for (const a of list) {
      expect(a.iata).toMatch(/^[A-Z]{3}$/);
      expect(a.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.countryName.length).toBeGreaterThan(0);
      expect(a.lat).toBeGreaterThanOrEqual(-90);
      expect(a.lat).toBeLessThanOrEqual(90);
      expect(a.lng).toBeGreaterThanOrEqual(-180);
      expect(a.lng).toBeLessThanOrEqual(180);
    }
  });

  it('is ranked 1 to n with no gaps', () => {
    expect(list.map((a) => a.rank)).toEqual(list.map((_, i) => i + 1));
  });

  it.each(['TLV', 'HND', 'NRT', 'JFK', 'LHR', 'DXB', 'SIN', 'ICN', 'CDG', 'SYD'])(
    'includes %s',
    (code) => {
      expect(list.some((a) => a.iata === code)).toBe(true);
    },
  );

  it('has the biggest hubs near the top', () => {
    const top = list.slice(0, 30).map((a) => a.iata);
    for (const code of ['ATL', 'LHR', 'CDG', 'JFK', 'DXB']) expect(top).toContain(code);
  });
});

describe('seedAirports', () => {
  it('puts the whole list in the database', async () => {
    await seedAirports(db);

    const rows = await db.select().from(airports);
    expect(rows).toHaveLength(loadAirports().length);
    const tlv = rows.find((r) => r.iataCode === 'TLV')!;
    expect(tlv).toMatchObject({
      icaoCode: 'LLBG',
      city: 'Tel Aviv',
      countryCode: 'IL',
      countryName: 'Israel',
    });
  });

  it('can be run again without duplicating anything', async () => {
    await seedAirports(db);
    await seedAirports(db);

    expect(await db.select().from(airports)).toHaveLength(loadAirports().length);
  });

  it('brings a changed airport back to what the list says', async () => {
    await seedAirports(db);
    await db.update(airports).set({ name: 'Wrong name' }).where(eq(airports.iataCode, 'TLV'));

    await seedAirports(db);

    const [tlv] = await db.select().from(airports).where(eq(airports.iataCode, 'TLV'));
    expect(tlv!.name).toMatch(/Ben Gurion/);
  });
});
