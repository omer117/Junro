import type { LatLng } from '@junro/solver';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { days, trips, users } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { fakeMaps } from '../test-maps.js';
import { decodePolyline, encodePolyline } from './polyline.js';
import { loadTransitRouteLine, readTransitRouteLine } from './route-line.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const p = (x: number): LatLng => ({ lat: 10, lng: x });
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

/** Every leg is drawn as a straight line from its start to its end. */
const fakeLegMaps = () =>
  fakeMaps({
    computeRoute: async ({ origin, destination }) => encodePolyline([origin, destination]),
  });

describe('loadTransitRouteLine: one line made of the legs', () => {
  it('draws each leg the way it is travelled, and joins them into one line', async () => {
    const maps = fakeLegMaps();

    const line = await loadTransitRouteLine({
      db,
      maps,
      dayId: await newDay(),
      route: [p(0), p(5), p(60)],
      legModes: ['walk', 'transit'],
      departureTime: MORNING,
    });

    expect(decodePolyline(line!)).toEqual([p(0), p(5), p(60)]);
    expect(maps.computeRoute.mock.calls.map(([r]) => [r.origin.lng, r.mode])).toEqual([
      [0, 'walking'],
      [5, 'transit'],
    ]);
    // Public transport legs carry the departure time, walking legs do not need one.
    expect(maps.computeRoute.mock.calls[1]![0].departureTime).toBe(MORNING);
  });

  it('costs nothing the second time, and readTransitRouteLine finds it without Google', async () => {
    const maps = fakeLegMaps();
    const args = {
      db,
      dayId: await newDay(),
      route: [p(0), p(5), p(60)],
      legModes: ['walk', 'transit'] as Array<'walk' | 'transit'>,
      departureTime: MORNING,
    };

    const first = await loadTransitRouteLine({ ...args, maps });
    maps.computeRoute.mockClear();
    const again = await loadTransitRouteLine({ ...args, maps });
    const read = await readTransitRouteLine(args);

    expect(again).toBe(first);
    expect(read).toBe(first);
    expect(maps.computeRoute).not.toHaveBeenCalled();
  });

  it('reuses the legs it already has when the route changes by one stop', async () => {
    const maps = fakeLegMaps();
    const dayId = await newDay();
    const base = { db, maps, dayId, departureTime: MORNING };

    await loadTransitRouteLine({
      ...base,
      route: [p(0), p(5), p(60)],
      legModes: ['walk', 'transit'],
    });
    maps.computeRoute.mockClear();
    await loadTransitRouteLine({
      ...base,
      route: [p(0), p(5), p(90)],
      legModes: ['walk', 'transit'],
    });

    // The first leg (0 to 5) is already drawn; only 5 to 90 is new.
    expect(maps.computeRoute).toHaveBeenCalledTimes(1);
    expect(maps.computeRoute.mock.calls[0]![0].destination.lng).toBe(90);
  });

  it('asks again for another hour, because the timetable changes', async () => {
    const maps = fakeLegMaps();
    const dayId = await newDay();
    const args = {
      db,
      maps,
      dayId,
      route: [p(0), p(60)],
      legModes: ['transit'] as Array<'walk' | 'transit'>,
    };

    await loadTransitRouteLine({ ...args, departureTime: MORNING });
    await loadTransitRouteLine({ ...args, departureTime: NOON });

    expect(maps.computeRoute).toHaveBeenCalledTimes(2);
  });
});
