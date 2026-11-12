import type { LatLng } from '@junro/solver';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { days, routeMatrixCache, trips, users } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { GoogleUnavailableError } from '../google/errors.js';
import { fakeMaps } from '../test-maps.js';
import { loadTravelTimes, MAX_MATRIX_POINTS } from './matrix.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/** Points on a line: x is the longitude, and one unit takes 60 seconds (= 1 minute). */
const p = (x: number): LatLng => ({ lat: 10, lng: x });

/** A fake Google that answers every origin/destination pair with |dx| minutes. */
const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng) * 60));

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

/** How many origin x destination elements a fake recorded (what Google would bill). */
const elementsAsked = (maps: ReturnType<typeof fakeMaps>) =>
  maps.routeMatrix.mock.calls.reduce(
    (sum, [req]) => sum + req.origins.length * req.destinations.length,
    0,
  );

function setup() {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
  });
  return { maps };
}

describe('loadTravelTimes', () => {
  it('asks Google once for all points, and answers in minutes', async () => {
    const { maps } = setup();
    const dayId = await newDay();

    const travel = await loadTravelTimes({
      db,
      maps,
      dayId,
      mode: 'walking',
      points: [p(0), p(10), p(30), p(0)], // start, two stages, end (= start)
    });

    expect(maps.routeMatrix).toHaveBeenCalledTimes(1);
    expect(travel(p(0), p(10), 0)).toBe(10);
    expect(travel(p(10), p(30), 999)).toBe(20); // departure time is ignored in beta
    expect(travel(p(30), p(0), 0)).toBe(30);
    expect(travel(p(10), p(10), 0)).toBe(0);
  });

  it('counts a start that equals the end as one point, not two', async () => {
    const { maps } = setup();

    await loadTravelTimes({
      db,
      maps,
      dayId: await newDay(),
      mode: 'walking',
      points: [p(0), p(10), p(30), p(0)],
    });

    const [request] = maps.routeMatrix.mock.calls[0]!;
    expect(request.origins).toHaveLength(3);
    expect(elementsAsked(maps)).toBe(9);
  });

  it('does not ask Google again for the same points', async () => {
    const { maps } = setup();
    const dayId = await newDay();
    const points = [p(0), p(10), p(30)];
    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points });

    const travel = await loadTravelTimes({ db, maps, dayId, mode: 'walking', points });

    expect(maps.routeMatrix).toHaveBeenCalledTimes(1);
    expect(travel(p(0), p(30), 0)).toBe(30);
  });

  it('answers the same points in another order from the cache', async () => {
    const { maps } = setup();
    const dayId = await newDay();
    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: [p(0), p(10), p(30)] });

    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: [p(30), p(0), p(10)] });

    expect(maps.routeMatrix).toHaveBeenCalledTimes(1);
  });

  it('asks only for the new row and column when one stage is added', async () => {
    const { maps } = setup();
    const dayId = await newDay();
    await loadTravelTimes({
      db,
      maps,
      dayId,
      mode: 'walking',
      points: [p(0), p(10), p(30), p(50)],
    });
    const before = elementsAsked(maps); // 16

    const travel = await loadTravelTimes({
      db,
      maps,
      dayId,
      mode: 'walking',
      points: [p(0), p(10), p(30), p(50), p(20)],
    });

    // new point -> all 5, plus the 4 old points -> new point = 9 elements, not 25.
    expect(elementsAsked(maps) - before).toBe(9);
    expect(travel(p(20), p(50), 0)).toBe(30);
    expect(travel(p(10), p(20), 0)).toBe(10);
    expect(travel(p(0), p(50), 0)).toBe(50); // an old pair is still there
  });

  it('does not ask Google when a stage is removed', async () => {
    const { maps } = setup();
    const dayId = await newDay();
    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: [p(0), p(10), p(30)] });

    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: [p(0), p(30)] });

    expect(maps.routeMatrix).toHaveBeenCalledTimes(1);
  });

  it('keeps walking and driving apart, and passes the mode to Google', async () => {
    const { maps } = setup();
    const dayId = await newDay();
    const points = [p(0), p(10)];

    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points });
    await loadTravelTimes({ db, maps, dayId, mode: 'driving', points });

    expect(maps.routeMatrix.mock.calls.map(([r]) => r.mode)).toEqual(['walking', 'driving']);
    expect(await db.select().from(routeMatrixCache)).toHaveLength(2);
  });

  it('caches per day: another day with the same points asks again', async () => {
    const { maps } = setup();
    const points = [p(0), p(10)];

    await loadTravelTimes({ db, maps, dayId: await newDay(), mode: 'walking', points });
    await loadTravelTimes({ db, maps, dayId: await newDay(), mode: 'walking', points });

    expect(maps.routeMatrix).toHaveBeenCalledTimes(2);
  });

  it('treats a leg Google cannot route as impossible (Infinity)', async () => {
    const maps = fakeMaps({
      routeMatrix: async ({ origins, destinations }) =>
        origins.map((o) =>
          destinations.map((d) => (d.lng === 99 ? Infinity : Math.abs(o.lng - d.lng) * 60)),
        ),
    });

    const travel = await loadTravelTimes({
      db,
      maps,
      dayId: await newDay(),
      mode: 'walking',
      points: [p(0), p(99)],
    });

    expect(travel(p(0), p(99), 0)).toBe(Infinity);
    expect(travel(p(99), p(0), 0)).toBe(99);
  });

  it('knows nothing about a point it was not given: Infinity, never a guess', async () => {
    const { maps } = setup();

    const travel = await loadTravelTimes({
      db,
      maps,
      dayId: await newDay(),
      mode: 'walking',
      points: [p(0), p(10)],
    });

    expect(travel(p(0), p(77), 0)).toBe(Infinity);
  });

  it('keeps what it already paid for when a later request fails, and asks only for the rest', async () => {
    let fail = false;
    const maps = fakeMaps({
      routeMatrix: async ({ origins, destinations }) => {
        if (fail) throw new GoogleUnavailableError();
        return lineMatrix(origins, destinations);
      },
    });
    const dayId = await newDay();
    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: [p(0), p(10), p(30)] });

    // Adding a stage needs two requests; the second one (old -> new) fails.
    let calls = 0;
    const flaky = fakeMaps({
      routeMatrix: async (request) => {
        calls += 1;
        if (calls === 2) throw new GoogleUnavailableError();
        return lineMatrix(request.origins, request.destinations);
      },
    });
    const points = [p(0), p(10), p(30), p(50)];
    await expect(
      loadTravelTimes({ db, maps: flaky, dayId, mode: 'walking', points }),
    ).rejects.toThrow(GoogleUnavailableError);

    // Retry: the first request's result was saved, so only the missing part is asked.
    fail = false;
    const retry = fakeMaps({
      routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    });
    const travel = await loadTravelTimes({ db, maps: retry, dayId, mode: 'walking', points });

    expect(retry.routeMatrix).toHaveBeenCalledTimes(1);
    expect(elementsAsked(retry)).toBe(3); // old points -> new point only
    expect(travel(p(30), p(50), 0)).toBe(20);
  });

  it('refuses more points than one Google request allows, before calling Google', async () => {
    const { maps } = setup();
    const points = Array.from({ length: MAX_MATRIX_POINTS + 1 }, (_, i) => p(i));

    await expect(
      loadTravelTimes({ db, maps, dayId: await newDay(), mode: 'walking', points }),
    ).rejects.toThrow(RangeError);
    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });

  it('stores the matrix against the day', async () => {
    const { maps } = setup();
    const dayId = await newDay();

    await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: [p(0), p(10)] });

    const rows = await db.select().from(routeMatrixCache).where(eq(routeMatrixCache.dayId, dayId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.travelMode).toBe('walking');
  });
});
