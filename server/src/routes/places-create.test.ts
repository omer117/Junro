import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { GooglePlaceNotFoundError } from '../google/errors.js';
import { createUsageGuard } from '../google/guard.js';
import type { PlaceDetails } from '../google/types.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const sensoji: PlaceDetails = {
  googlePlaceId: 'ChIJ-sensoji-0001',
  name: 'Senso-ji',
  lat: 35.7148,
  lng: 139.7967,
  openingHours: { periods: [{ open: { day: 0, hour: 6, minute: 0 } }] },
};

const usedDetails = async () =>
  (
    await createUsageGuard({
      db,
      caps: { autocomplete: 1e9, placeDetails: 1e9, routeMatrix: 1e9, computeRoutes: 1e9 },
    }).usage()
  ).placeDetails;

async function setup(overrides: Parameters<typeof createTestApp>[1] = {}) {
  const maps = fakeMaps({ placeDetails: async () => sensoji });
  const app = createTestApp(db, { maps, ...overrides });
  const { agent } = await signInAs(db, app);
  return { maps, app, agent };
}

describe('POST /places', () => {
  it('requires sign-in and does not call Google for an anonymous request', async () => {
    const { maps, app } = await setup();

    await request(app).post('/places').send({ googlePlaceId: sensoji.googlePlaceId }).expect(401);

    expect(maps.placeDetails).not.toHaveBeenCalled();
  });

  it('fetches the place from Google once and stores it', async () => {
    const { agent, maps } = await setup();

    const res = await agent
      .post('/places')
      .send({ googlePlaceId: sensoji.googlePlaceId, sessionToken: 'session-token-1' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      googlePlaceId: sensoji.googlePlaceId,
      name: 'Senso-ji',
      lat: 35.7148,
      lng: 139.7967,
    });
    expect(maps.placeDetails).toHaveBeenCalledWith({
      googlePlaceId: sensoji.googlePlaceId,
      sessionToken: 'session-token-1',
    });
    const [row] = await db.select().from(places);
    expect(row!.openingHours).toEqual(sensoji.openingHours);
    expect(await usedDetails()).toBe(1);
  });

  it('never asks Google again for a place we already have, whoever adds it', async () => {
    const { agent, app, maps } = await setup();
    await agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId }).expect(201);
    const bob = await signInAs(db, app, 'Bob');

    const again = await bob.agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId });

    expect(again.status).toBe(200);
    expect(again.body.name).toBe('Senso-ji');
    expect(maps.placeDetails).toHaveBeenCalledTimes(1);
    expect(await usedDetails()).toBe(1);
    expect(await db.select().from(places)).toHaveLength(1);
  });

  it('makes one Google call when the same new place is added twice at the same moment', async () => {
    const { agent, app, maps } = await setup();
    const bob = await signInAs(db, app, 'Bob');

    await Promise.all([
      agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId }),
      bob.agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId }),
    ]);

    expect(maps.placeDetails).toHaveBeenCalledTimes(1);
    expect(await db.select().from(places)).toHaveLength(1);
  });

  it.each([
    {},
    { googlePlaceId: '' },
    { googlePlaceId: 'short' },
    { googlePlaceId: 'has spaces in it' },
    { googlePlaceId: 'x'.repeat(300) },
  ])('refuses a place id that cannot be real (%j) without calling Google', async (body) => {
    const { agent, maps } = await setup();

    const res = await agent.post('/places').send(body);

    expect(res.status).toBe(400);
    expect(maps.placeDetails).not.toHaveBeenCalled();
  });

  it('answers 404 when Google does not know the place, and stores nothing', async () => {
    const maps = fakeMaps({
      placeDetails: async () => {
        throw new GooglePlaceNotFoundError();
      },
    });
    const app = createTestApp(db, { maps });
    const { agent } = await signInAs(db, app);

    const res = await agent.post('/places').send({ googlePlaceId: 'ChIJ-does-not-exist' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('place_not_found');
    expect(await db.select().from(places)).toHaveLength(0);
  });

  it('stops before Google when the monthly cap is reached, but still serves stored places', async () => {
    const { agent, maps } = await setup({
      quotaCaps: { autocomplete: 1, placeDetails: 1, routeMatrix: 1, computeRoutes: 1 },
    });
    await agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId }).expect(201);

    const another = await agent.post('/places').send({ googlePlaceId: 'ChIJ-another-place' });
    const stored = await agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId });

    expect(another.status).toBe(429);
    expect(stored.status).toBe(200);
    expect(maps.placeDetails).toHaveBeenCalledTimes(1);
  });

  it('limits how many new places one user can add per minute', async () => {
    const { agent, maps } = await setup({ placeRateLimit: 2 });

    const statuses = [];
    for (const id of ['ChIJ-place-aaaa', 'ChIJ-place-bbbb', 'ChIJ-place-cccc']) {
      statuses.push((await agent.post('/places').send({ googlePlaceId: id })).status);
    }

    expect(statuses).toEqual([201, 201, 429]);
    expect(maps.placeDetails).toHaveBeenCalledTimes(2);
  });

  it('keeps a stored place intact (the row is the one fetched, nobody can rewrite it)', async () => {
    const { agent } = await setup();
    await agent.post('/places').send({ googlePlaceId: sensoji.googlePlaceId }).expect(201);

    const [row] = await db
      .select()
      .from(places)
      .where(eq(places.googlePlaceId, sensoji.googlePlaceId));

    expect(row!.name).toBe('Senso-ji');
  });
});
