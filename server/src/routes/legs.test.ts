import type { LatLng } from '@junro/solver';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import type { TransitOption } from '../google/types.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';
import { encodePolyline } from '../travel/polyline.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/** Tokyo, on a line: x minutes of walking east of the start. The train is three times faster. */
const at = (x: number): LatLng => ({ lat: 35.68, lng: 139.76 + x / 100 });
const minutesBetween = (a: LatLng, b: LatLng) => Math.abs(a.lng - b.lng) * 100;

const options: TransitOption[] = [
  {
    minutes: 30,
    walkMinutes: 10,
    transfers: 1,
    steps: [{ kind: 'transit', minutes: 20, line: 'Ginza Line' }],
  },
  { minutes: 22, walkMinutes: 6, transfers: 0, steps: [{ kind: 'transit', minutes: 16 }] },
];

let counter = 0;
async function setup(
  travelMode: 'transit' | 'walking' = 'transit',
  overrides: Parameters<typeof createTestApp>[1] = {},
) {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations, mode }) =>
      origins.map((a) =>
        destinations.map((b) => (minutesBetween(a, b) * 60) / (mode === 'transit' ? 3 : 1)),
      ),
    computeRoute: async ({ origin, destination }) => encodePolyline([origin, destination]),
    transitAlternatives: async () => options,
  });
  const app = createTestApp(db, { maps, ...overrides });
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
        googlePlaceId: `ChIJ-legs-${counter}`,
        name: `Place ${x}`,
        lat: at(x).lat,
        lng: at(x).lng,
      })
      .returning();
    await agent.post(`/days/${day.id}/stages`).send({ placeId: place!.id, category: 'park' });
  };
  const solve = () => agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });
  return { app, agent, maps, day, addStage, solve };
}

describe('GET /days/:id/legs/:index/alternatives', () => {
  it('gives the ways to make one leg, the quickest first, and leaves out nothing Google found', async () => {
    const { agent, maps, day, addStage, solve } = await setup();
    await addStage(60);
    await solve();

    const res = await agent.get(`/days/${day.id}/legs/0/alternatives?at=540`);

    expect(res.status).toBe(200);
    expect(res.body.options.map((o: TransitOption) => o.minutes)).toEqual([22, 30]);
    // The leg goes from the start (the hotel) to the one stop; asked for 09:00 Tokyo time.
    const [request] = maps.transitAlternatives.mock.calls[0]!;
    expect(request.origin).toEqual(at(0));
    expect(request.destination).toEqual(at(60));
    expect(request.departureTime).toBe('2027-04-01T00:00:00.000Z');
  });

  it('stops at the monthly cap for public transport routes, and does not call Google', async () => {
    const { agent, maps, day, addStage, solve } = await setup('transit', {
      quotaCaps: {
        autocomplete: 100,
        placeDetails: 100,
        routeMatrix: 1e9,
        computeRoutes: 100,
        transitMatrix: 1e9,
        transitRoutes: 0,
      },
    });
    await addStage(60);
    await solve(); // the order is still found; only the lines are refused

    const res = await agent.get(`/days/${day.id}/legs/0/alternatives?at=540`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('quota_reached');
    expect(maps.transitAlternatives).not.toHaveBeenCalled();
  });

  it('only makes sense for a public transport day', async () => {
    const { agent, maps, day, addStage, solve } = await setup('walking');
    await addStage(60);
    await solve();

    const res = await agent.get(`/days/${day.id}/legs/0/alternatives?at=540`);

    expect(res.status).toBe(409);
    expect(maps.transitAlternatives).not.toHaveBeenCalled();
  });

  it('answers 404 for a leg that is not in the route, and 400 for a missing or bad time', async () => {
    const { agent, maps, day, addStage, solve } = await setup();
    await addStage(60);
    await solve();

    await agent.get(`/days/${day.id}/legs/9/alternatives?at=540`).expect(404);
    await agent.get(`/days/${day.id}/legs/0/alternatives`).expect(400);
    await agent.get(`/days/${day.id}/legs/0/alternatives?at=abc`).expect(400);

    expect(maps.transitAlternatives).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's day and never reaches Google", async () => {
    const { app, maps, day, addStage, solve } = await setup();
    await addStage(60);
    await solve();
    const bob = await signInAs(db, app, 'Bob');

    await bob.agent.get(`/days/${day.id}/legs/0/alternatives?at=540`).expect(404);

    expect(maps.transitAlternatives).not.toHaveBeenCalled();
  });

  it('requires sign-in', async () => {
    const { app, day } = await setup();

    const anonymous = await import('supertest').then((m) =>
      m.default(app).get(`/days/${day.id}/legs/0/alternatives?at=540`),
    );

    expect(anonymous.status).toBe(401);
  });
});
