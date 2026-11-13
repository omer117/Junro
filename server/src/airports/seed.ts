import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { airports } from '../db/schema.js';

const airportSchema = z.object({
  iata: z.string().regex(/^[A-Z]{3}$/),
  icao: z.string(),
  name: z.string().min(1),
  city: z.string(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  countryName: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  rank: z.number().int().positive(),
});

export type AirportRecord = z.infer<typeof airportSchema>;

/** Reads and checks server/data/airports.json (built by scripts/build-airports.ts). */
export function loadAirports(): AirportRecord[] {
  const file = join(import.meta.dirname, '../../data/airports.json');
  return z.array(airportSchema).parse(JSON.parse(readFileSync(file, 'utf-8')));
}

/** Puts the list in the database. Safe to run again: an existing airport is brought up to date. */
export async function seedAirports(db: Db): Promise<number> {
  const list = loadAirports();
  await db.transaction(async (tx) => {
    for (const a of list) {
      const row = {
        iataCode: a.iata,
        icaoCode: a.icao || null,
        name: a.name,
        city: a.city,
        countryCode: a.countryCode,
        countryName: a.countryName,
        lat: a.lat,
        lng: a.lng,
        rank: a.rank,
      };
      await tx
        .insert(airports)
        .values(row)
        .onConflictDoUpdate({
          target: airports.iataCode,
          set: {
            icaoCode: sql`excluded.icao_code`,
            name: sql`excluded.name`,
            city: sql`excluded.city`,
            countryCode: sql`excluded.country_code`,
            countryName: sql`excluded.country_name`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            rank: sql`excluded.rank`,
          },
        });
    }
  });
  return list.length;
}
