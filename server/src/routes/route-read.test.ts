import type { LatLng } from '@junro/solver';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import type { OpeningHours } from '../google/types.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/** Everything is on a line: longitude is the distance, one unit = 1 minute of travel. */
const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng) * 60));

const goodMaps = () =>
  fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    computeRoute: async ({ intermediates }) => `line-through-${intermediates.length}`,
  });

const googleCalls = (maps: ReturnType<typeof fakeMaps>) =>
  maps.routeMatrix.mock.calls.length + maps.computeRoute.mock.calls.length;

const dayBody = {
  date: '2027-04-01', // a Thursday
  start: { lat: 10, lng: 0 },
  end: { lat: 10, lng: 0 },
  startTime: 540,
  travelMode: 'walking',
};

let counter = 0;
async function newPlace(x: number, openingHours?: OpeningHours) {
  counter += 1;
  const [place] = await db
    .insert(places)
    .values({
      googlePlaceId: `ChIJ-read-${counter}-x${x}`,
      name: `Place ${x}`,
      lat: 10,
      lng: x,
      openingHours: openingHours ?? null,
    })
    .returning();
  return place!;
}

async function setup() {
  const maps = goodMaps();
  const app = createTestApp(db, { maps });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(dayBody);
  const addStage = async (x: number, extra: { openingHours?: OpeningHours } = {}) => {
    const place = await newPlace(x, extra.openingHours);
    const { body } = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'park' });
    return body as { id: string };
  };
  const solve = () => agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });
  const route = () => agent.get(`/days/${day.id}/route`);
  return { app, agent, maps, day, addStage, solve, route };
}

describe('GET /days/:id/route (the saved route, from cached data only)', () => {
  it('requires sign-in', async () => {
    const { app, day } = await setup();

    await request(app).get(`/days/${day.id}/route`).expect(401);
  });

  it("answers 404 for someone else's day", async () => {
    const { app, day } = await setup();
    const bob = await signInAs(db, app, 'Bob');

    await bob.agent.get(`/days/${day.id}/route`).expect(404);
  });

  it('says there is no route before the day has been solved', async () => {
    const { addStage, route } = await setup();
    await addStage(10);

    const res = await route();

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('no_route');
  });

  it('returns the same route as the solve gave, without calling Google', async () => {
    const { maps, addStage, solve, route } = await setup();
    await addStage(10);
    await addStage(20);
    const solved = await solve().expect(200);
    const before = googleCalls(maps);

    const res = await route();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...solved.body, mode: 'saved' });
    expect(googleCalls(maps)).toBe(before);
  });

  it('says there is no route once a new stop has been added (it needs a new solve)', async () => {
    const { addStage, solve, route } = await setup();
    await addStage(10);
    await solve().expect(200);
    await addStage(25);

    const res = await route();

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('no_route');
  });

  it('follows a change of stay without asking Google', async () => {
    const { agent, maps, addStage, solve, route } = await setup();
    const stop = await addStage(10);
    const solved = await solve().expect(200);
    const before = googleCalls(maps);
    await agent.patch(`/stages/${stop.id}`).send({ stayOverrideMinutes: 60 }).expect(200);

    const res = await route();

    // 40 minutes more at the stop (60 instead of the default 20).
    expect(res.status).toBe(200);
    expect(res.body.endArrival).toBe(solved.body.endArrival + 40);
    expect(googleCalls(maps)).toBe(before);
  });

  it('still has a route, without the line, after a stop is removed', async () => {
    const { agent, addStage, solve, route } = await setup();
    await addStage(10);
    const removed = await addStage(20);
    await solve().expect(200);
    await agent.delete(`/stages/${removed.id}`).expect(204);

    const res = await route();

    expect(res.status).toBe(200);
    expect(res.body.order).toHaveLength(1);
    expect(res.body.routeLine).toBeNull();
  });

  it('says there is no route after the travel mode changes, because that needs new travel times', async () => {
    const { agent, addStage, solve, route, day } = await setup();
    await addStage(10);
    await solve().expect(200);
    await agent.patch(`/days/${day.id}`).send({ travelMode: 'driving' }).expect(200);

    const res = await route();

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('no_route');
  });

  it('keeps the warnings: a stop that closes before you are done', async () => {
    const { addStage, solve, route } = await setup();
    const closesAt9h20: OpeningHours = {
      periods: [{ open: { day: 4, hour: 6, minute: 0 }, close: { day: 4, hour: 9, minute: 20 } }],
    };
    const tight = await addStage(10, { openingHours: closesAt9h20 });
    await solve().expect(200);

    const res = await route();

    expect(res.body.violations).toEqual([{ stageId: tight.id, kind: 'closed', minutesLate: 10 }]);
  });

  it('is not in the rate limit: reading the route is free', async () => {
    const { addStage, solve, route } = await setup();
    await addStage(10);
    await solve().expect(200);

    for (let i = 0; i < 15; i++) await route().expect(200);
  });
});
