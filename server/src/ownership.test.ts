import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from './db/client.js';
import { days, places, stages, trips } from './db/schema.js';
import { resetDb, testDatabaseUrl } from './db/test-db.js';
import { createTestApp, signInAs } from './test-app.js';

const { db, pool } = createDb(testDatabaseUrl);
const app = createTestApp(db);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/**
 * One table with every route that takes an id of someone's data. Two guarantees are checked
 * for each: anonymous callers get 401, and a different signed-in user gets 404 and changes
 * nothing. A new route that touches trips, days or stages belongs in this table.
 */
const routes: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: object }> =
  [
    { method: 'get', path: '/trips/:trip' },
    { method: 'patch', path: '/trips/:trip', body: { name: 'Hacked' } },
    { method: 'delete', path: '/trips/:trip' },
    { method: 'get', path: '/trips/:trip/days' },
    {
      method: 'post',
      path: '/trips/:trip/days',
      body: {
        date: '2027-04-02',
        start: { lat: 1, lng: 1 },
        end: { lat: 1, lng: 1 },
        startTime: 60,
        travelMode: 'driving',
      },
    },
    { method: 'get', path: '/days/:day' },
    { method: 'patch', path: '/days/:day', body: { startTime: 1 } },
    { method: 'delete', path: '/days/:day' },
    { method: 'get', path: '/days/:day/stages' },
    { method: 'post', path: '/days/:day/stages', body: { placeId: ':place', category: 'park' } },
    { method: 'get', path: '/stages/:stage' },
    { method: 'patch', path: '/stages/:stage', body: { done: true } },
    { method: 'delete', path: '/stages/:stage' },
    { method: 'post', path: '/days/:day/solve', body: { mode: 'full' } },
    { method: 'get', path: '/places/search' },
    { method: 'get', path: '/airports?q=tlv' },
    { method: 'post', path: '/places', body: { googlePlaceId: 'ChIJ-some-place-id' } },
    { method: 'get', path: '/trips' },
    { method: 'post', path: '/trips', body: { name: 'x' } },
    { method: 'get', path: '/me/stay-durations' },
    { method: 'put', path: '/me/stay-durations/museum', body: { stayMinutes: 90 } },
  ] as never;

async function anAnnWorld() {
  const ann = await signInAs(db, app, 'Ann');
  const { body: trip } = await ann.agent.post('/trips').send({ name: 'Private' });
  const { body: day } = await ann.agent.post(`/trips/${trip.id}/days`).send({
    date: '2027-04-01',
    start: { lat: 1, lng: 1 },
    end: { lat: 1, lng: 1 },
    startTime: 540,
    travelMode: 'walking',
  });
  const [place] = await db
    .insert(places)
    .values({ googlePlaceId: 'p', name: 'P', lat: 1, lng: 1 })
    .returning();
  const { body: stage } = await ann.agent
    .post(`/days/${day.id}/stages`)
    .send({ placeId: place!.id, category: 'park' });
  const fill = (s: string) =>
    s
      .replace(':trip', trip.id)
      .replace(':day', day.id)
      .replace(':stage', stage.id)
      .replace(':place', place!.id);
  return { ann, fill, trip, day, stage };
}

const needsResource = (path: string) => /:(trip|day|stage)/.test(path);

describe('every route requires sign-in', () => {
  it.each(routes.map((r) => [r.method.toUpperCase(), r.path, r] as const))(
    '%s %s answers 401 to an anonymous caller',
    async (_method, _path, route) => {
      const { fill } = await anAnnWorld();

      const res = await request(app)
        [route.method](fill(route.path))
        .send(route.body ?? {});

      expect(res.status).toBe(401);
    },
  );
});

describe("a different user cannot reach someone else's data", () => {
  it.each(
    routes
      .filter((r) => needsResource(r.path))
      .map((r) => [r.method.toUpperCase(), r.path, r] as const),
  )('%s %s answers 404 and changes nothing', async (_method, _path, route) => {
    const { fill, trip, day, stage } = await anAnnWorld();
    const bob = await signInAs(db, app, 'Bob');
    const fillBody = (b: object | undefined) => (b ? JSON.parse(fill(JSON.stringify(b))) : {});

    const res = await bob.agent[route.method](fill(route.path)).send(fillBody(route.body));

    expect(res.status).toBe(404);
    // Ann's data is exactly as she left it.
    expect(await db.select().from(trips).where(eq(trips.id, trip.id))).toMatchObject([
      { name: 'Private' },
    ]);
    expect(await db.select().from(days).where(eq(days.id, day.id))).toMatchObject([
      { startTime: 540 },
    ]);
    expect(await db.select().from(stages).where(eq(stages.id, stage.id))).toMatchObject([
      { done: false },
    ]);
    expect(await db.select().from(days)).toHaveLength(1);
    expect(await db.select().from(stages)).toHaveLength(1);
  });
});

describe('collection routes are scoped to the caller', () => {
  it("GET /trips never includes someone else's trips", async () => {
    const { trip } = await anAnnWorld();
    const bob = await signInAs(db, app, 'Bob');

    const res = await bob.agent.get('/trips');

    expect(res.body).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(trip.id);
  });
});
