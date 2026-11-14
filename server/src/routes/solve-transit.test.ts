import type { LatLng } from '@junro/solver';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';
import { decodePolyline, encodePolyline } from '../travel/polyline.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/** Tokyo, on a line: x minutes of walking east of the start. The train is three times faster. */
const at = (x: number): LatLng => ({ lat: 35.68, lng: 139.76 + x / 100 });
const minutesBetween = (a: LatLng, b: LatLng) => Math.abs(a.lng - b.lng) * 100;
const walk = (o: LatLng[], d: LatLng[]) => o.map((a) => d.map((b) => minutesBetween(a, b) * 60));
const train = (o: LatLng[], d: LatLng[]) =>
  o.map((a) => d.map((b) => (minutesBetween(a, b) * 60) / 3));

const transitMaps = () =>
  fakeMaps({
    routeMatrix: async ({ origins, destinations, mode }) =>
      mode === 'transit' ? train(origins, destinations) : walk(origins, destinations),
    computeRoute: async ({ origin, destination }) => encodePolyline([origin, destination]),
  });

let counter = 0;
async function setup(travelMode: 'transit' | 'walking' = 'transit') {
  const maps = transitMaps();
  const app = createTestApp(db, { maps });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const { body: day } = await agent.post(`/trips/${trip.id}/days`).send({
    date: '2027-04-01',
    start: at(0),
    end: at(0),
    startTime: 540,
    travelMode,
  });
  const addStage = async (x: number) => {
    counter += 1;
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: `ChIJ-transit-${counter}`,
        name: `Place ${x}`,
        lat: at(x).lat,
        lng: at(x).lng,
      })
      .returning();
    const { body } = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place!.id, category: 'park' });
    return body as { id: string };
  };
  const solve = () => agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });
  return { agent, maps, day, addStage, solve };
}

const transitCalls = (maps: ReturnType<typeof transitMaps>) =>
  maps.routeMatrix.mock.calls.filter(([r]) => r.mode === 'transit');

describe('a public transport day', () => {
  it('can be created with the transit travel mode', async () => {
    const { day } = await setup();

    expect(day.travelMode).toBe('transit');
  });

  it('walks the short hops and rides the long one, and tells every leg', async () => {
    const { maps, addStage, solve } = await setup();
    await addStage(5); // 5 minutes on foot from the hotel: walked
    await addStage(60); // an hour on foot, 20 minutes by train

    const res = await solve();

    expect(res.status).toBe(200);
    // Three legs: a 5 minute walk, and two train rides (18 and 20 minutes). Going to the far
    // place first or last takes the same time, so the order of the legs may differ.
    expect(res.body.legs).toHaveLength(3);
    expect(
      [...res.body.legs].sort(
        (x: { minutes: number }, y: { minutes: number }) => x.minutes - y.minutes,
      ),
    ).toEqual([
      { mode: 'walk', minutes: 5 },
      { mode: 'transit', minutes: 18 },
      { mode: 'transit', minutes: 20 },
    ]);
    // The solver used the train time: the day ends 5 + 20 (stay) + 18.3 + 20 (stay) + 20 later.
    expect(res.body.endArrival).toBeCloseTo(540 + 5 + 20 + 55 / 3 + 20 + 20, 1);
    expect(transitCalls(maps).length).toBeGreaterThan(0);
  });

  it('asks Google for the local time of the day, as an exact moment', async () => {
    const { maps, addStage, solve } = await setup();
    await addStage(60);

    await solve();

    // 09:00 in Tokyo (UTC+9) is 00:00 UTC.
    expect(transitCalls(maps)[0]![0].departureTime).toBe('2027-04-01T00:00:00.000Z');
  });

  it('never asks about public transport when everything is within a short walk', async () => {
    const { maps, addStage, solve } = await setup();
    await addStage(3);
    await addStage(7);

    const res = await solve();

    expect(res.status).toBe(200);
    expect(res.body.legs.every((leg: { mode: string }) => leg.mode === 'walk')).toBe(true);
    expect(transitCalls(maps)).toHaveLength(0);
  });

  it('draws one joined line through every leg', async () => {
    const { addStage, solve } = await setup();
    await addStage(5);
    await addStage(60);

    const res = await solve();

    expect(decodePolyline(res.body.routeLine).length).toBeGreaterThanOrEqual(4);
  });

  it('shows the saved route again without calling Google, with the same legs', async () => {
    const { agent, maps, day, addStage, solve } = await setup();
    await addStage(5);
    await addStage(60);
    const solved = await solve();
    maps.routeMatrix.mockClear();
    maps.computeRoute.mockClear();

    const saved = await agent.get(`/days/${day.id}/route`);

    expect(saved.status).toBe(200);
    expect(saved.body.legs).toEqual(solved.body.legs);
    expect(saved.body.endArrival).toBe(solved.body.endArrival);
    expect(saved.body.routeLine).toBe(solved.body.routeLine);
    expect(maps.routeMatrix).not.toHaveBeenCalled();
    expect(maps.computeRoute).not.toHaveBeenCalled();
  });

  it('a walking day has no legs in its answer', async () => {
    const { addStage, solve } = await setup('walking');
    await addStage(5);

    const res = await solve();

    expect(res.status).toBe(200);
    expect(res.body.legs).toBeUndefined();
  });
});
