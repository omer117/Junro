import type { LatLng } from '@junro/solver';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { days, trips, users } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { fakeMaps } from '../test-maps.js';
import { loadHybridTimes, readCachedHybridTimes } from './hybrid.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/** Points on a line: x is the longitude. Walking takes |dx| minutes, the train |dx| / 3 minutes. */
const p = (x: number): LatLng => ({ lat: 10, lng: x });
const walkMatrix = (o: LatLng[], d: LatLng[]) =>
  o.map((a) => d.map((b) => Math.abs(a.lng - b.lng) * 60));
const trainMatrix = (o: LatLng[], d: LatLng[]) =>
  o.map((a) => d.map((b) => (Math.abs(a.lng - b.lng) * 60) / 3));

const MORNING = '2027-04-01T00:00:00.000Z';
const NOON = '2027-04-01T03:00:00.000Z';

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
      travelMode: 'transit',
    })
    .returning();
  return day!.id;
}

function setup() {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations, mode }) =>
      mode === 'transit' ? trainMatrix(origins, destinations) : walkMatrix(origins, destinations),
  });
  const transitPairs = () =>
    maps.routeMatrix.mock.calls
      .filter(([r]) => r.mode === 'transit')
      .flatMap(([r]) => r.origins.flatMap((o) => r.destinations.map((d) => `${o.lng}>${d.lng}`)));
  return { maps, transitPairs };
}

describe('loadHybridTimes: walk where it is close, ride where it is far', () => {
  it('walks a short hop and rides a long one, and says which is which', async () => {
    const { maps } = setup();
    const dayId = await newDay();

    const { travelTime, legMode } = await loadHybridTimes({
      db,
      maps,
      dayId,
      points: [p(0), p(5), p(60)],
      departureTime: MORNING,
    });

    expect(travelTime(p(0), p(5), 540)).toBe(5); // walked: 5 minutes
    expect(legMode(p(0), p(5))).toBe('walk');
    expect(travelTime(p(0), p(60), 540)).toBe(20); // by train: 60 minutes of walking is 20
    expect(legMode(p(0), p(60))).toBe('transit');
  });

  it('never asks about public transport for places that are close enough to walk', async () => {
    const { maps, transitPairs } = setup();
    const dayId = await newDay();

    await loadHybridTimes({
      db,
      maps,
      dayId,
      points: [p(0), p(5), p(8), p(60)],
      departureTime: MORNING,
    });

    // 0, 5 and 8 are all within 10 minutes of each other on foot: only the pairs with 60 are asked.
    expect(transitPairs().sort()).toEqual(['0>60', '5>60', '8>60', '60>0', '60>5', '60>8'].sort());
  });

  it('keeps walking when there is no public transport route, even a long walk', async () => {
    const maps = fakeMaps({
      routeMatrix: async ({ origins, destinations, mode }) =>
        mode === 'transit'
          ? origins.map(() => destinations.map(() => Infinity))
          : walkMatrix(origins, destinations),
    });
    const dayId = await newDay();

    const { travelTime, legMode } = await loadHybridTimes({
      db,
      maps,
      dayId,
      points: [p(0), p(60)],
      departureTime: MORNING,
    });

    expect(travelTime(p(0), p(60), 540)).toBe(60);
    expect(legMode(p(0), p(60))).toBe('walk');
  });

  it('pays only once: the same day and the same hour cost nothing the second time', async () => {
    const { maps, transitPairs } = setup();
    const dayId = await newDay();
    const args = { db, maps, dayId, points: [p(0), p(60)], departureTime: MORNING };

    await loadHybridTimes(args);
    const first = transitPairs().length;
    await loadHybridTimes(args);

    expect(first).toBe(2);
    expect(transitPairs().length).toBe(2);
  });

  it('asks again for another hour, because the timetable changes through the day', async () => {
    const { maps, transitPairs } = setup();
    const dayId = await newDay();
    const points = [p(0), p(60)];

    await loadHybridTimes({ db, maps, dayId, points, departureTime: MORNING });
    await loadHybridTimes({ db, maps, dayId, points, departureTime: NOON });

    expect(transitPairs().length).toBe(4);
  });

  it('adding a place asks only for the new pairs', async () => {
    const { maps, transitPairs } = setup();
    const dayId = await newDay();

    await loadHybridTimes({ db, maps, dayId, points: [p(0), p(60)], departureTime: MORNING });
    await loadHybridTimes({
      db,
      maps,
      dayId,
      points: [p(0), p(60), p(90)],
      departureTime: MORNING,
    });

    expect(transitPairs().slice(2).sort()).toEqual(['0>90', '60>90', '90>0', '90>60'].sort());
  });
});

describe('readCachedHybridTimes', () => {
  it('never calls Google, answers null until everything needed is known, then answers', async () => {
    const { maps } = setup();
    const dayId = await newDay();
    const points = [p(0), p(60)];

    expect(await readCachedHybridTimes({ db, dayId, points, departureTime: MORNING })).toBeNull();

    await loadHybridTimes({ db, maps, dayId, points, departureTime: MORNING });
    maps.routeMatrix.mockClear();
    const read = await readCachedHybridTimes({ db, dayId, points, departureTime: MORNING });

    expect(read?.travelTime(p(0), p(60), 540)).toBe(20);
    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });
});
