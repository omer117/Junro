import type { LatLng } from '@junro/solver';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { days, trips, users } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { GoogleUnavailableError } from '../google/errors.js';
import { fakeMaps } from '../test-maps.js';
import { loadRouteLine } from './route-line.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const p = (x: number): LatLng => ({ lat: 10, lng: x });

async function newDay(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ provider: 'google', providerId: `g-${Math.random()}`, email: 'a@x.com', name: 'A' })
    .returning();
  const [trip] = await db.insert(trips).values({ userId: user!.id, name: 'T' }).returning();
  const [day] = await db
    .insert(days)
    .values({
      tripId: trip!.id,
      date: '2027-04-01',
      startLat: 10,
      startLng: 0,
      endLat: 10,
      endLng: 0,
      startTime: 540,
      travelMode: 'walking',
    })
    .returning();
  return day!.id;
}

const maps = () => fakeMaps({ computeRoute: async () => 'ENCODED-LINE' });

describe('loadRouteLine', () => {
  it('asks Google for the line through start, stages in order, and end', async () => {
    const fake = maps();

    const line = await loadRouteLine({
      db,
      maps: fake,
      dayId: await newDay(),
      mode: 'walking',
      route: [p(0), p(10), p(30), p(0)],
    });

    expect(line).toBe('ENCODED-LINE');
    expect(fake.computeRoute).toHaveBeenCalledWith({
      origin: p(0),
      destination: p(0),
      intermediates: [p(10), p(30)],
      mode: 'walking',
    });
  });

  it('does not ask again for the same route', async () => {
    const fake = maps();
    const dayId = await newDay();
    const route = [p(0), p(10), p(30), p(0)];
    await loadRouteLine({ db, maps: fake, dayId, mode: 'walking', route });

    const again = await loadRouteLine({ db, maps: fake, dayId, mode: 'walking', route });

    expect(again).toBe('ENCODED-LINE');
    expect(fake.computeRoute).toHaveBeenCalledTimes(1);
  });

  it('asks again when the order, the stops or the mode change', async () => {
    const fake = maps();
    const dayId = await newDay();
    const ask = (mode: 'walking' | 'driving', route: LatLng[]) =>
      loadRouteLine({ db, maps: fake, dayId, mode, route });

    await ask('walking', [p(0), p(10), p(30), p(0)]);
    await ask('walking', [p(0), p(30), p(10), p(0)]);
    await ask('walking', [p(0), p(30), p(0)]);
    await ask('driving', [p(0), p(30), p(0)]);

    expect(fake.computeRoute).toHaveBeenCalledTimes(4);
  });

  it('needs no line when there is nothing to travel (no stages, start = end)', async () => {
    const fake = maps();

    const line = await loadRouteLine({
      db,
      maps: fake,
      dayId: await newDay(),
      mode: 'walking',
      route: [p(0), p(0)],
    });

    expect(line).toBeNull();
    expect(fake.computeRoute).not.toHaveBeenCalled();
  });

  it('keeps the previous line when Google fails', async () => {
    const dayId = await newDay();
    await loadRouteLine({ db, maps: maps(), dayId, mode: 'walking', route: [p(0), p(10), p(0)] });
    const failing = fakeMaps({
      computeRoute: async () => {
        throw new GoogleUnavailableError();
      },
    });

    await expect(
      loadRouteLine({ db, maps: failing, dayId, mode: 'walking', route: [p(0), p(20), p(0)] }),
    ).rejects.toThrow(GoogleUnavailableError);

    const [day] = await db.select().from(days).where(eq(days.id, dayId));
    expect(day!.polyline).toBe('ENCODED-LINE');
  });
});
