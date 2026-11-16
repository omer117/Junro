import type { LatLng } from '@junro/solver';
import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places, routeMatrixCache } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createRedis, type RedisConnection, type RedisHandle } from '../redis.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';
import { testRedisUrl } from '../test-redis.js';

const { db, pool } = createDb(testDatabaseUrl);
let redis: RedisConnection;

beforeAll(async () => {
  redis = createRedis(testRedisUrl);
  for (let i = 0; i < 50 && !redis.isReady; i++) await new Promise((r) => setTimeout(r, 100));
});
beforeEach(async () => {
  await resetDb(db);
  await redis.flush();
});
afterAll(async () => {
  await redis.close();
  await pool.end();
});

const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng) * 60));

let counter = 0;
async function setup(redisDep: RedisHandle | undefined) {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    computeRoute: async () => 'LINE',
  });
  const app = createTestApp(db, { maps, ...(redisDep ? { redis: redisDep } : {}) });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'T' });
  const { body: day } = await agent.post(`/trips/${trip.id}/days`).send({
    date: '2027-04-01',
    start: { lat: 10, lng: 0 },
    end: { lat: 10, lng: 0 },
    startTime: 540,
    travelMode: 'walking',
  });
  const addStage = async (x: number) => {
    counter += 1;
    const [place] = await db
      .insert(places)
      .values({ googlePlaceId: `ChIJ-mc-${counter}`, name: `P${x}`, lat: 10, lng: x })
      .returning();
    await agent.post(`/days/${day.id}/stages`).send({ placeId: place!.id, category: 'park' });
  };
  const solve = () => agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });
  const key = `junro:matrix:${day.id}:walking`;
  return { agent, maps, day, addStage, solve, key };
}

/** Reads and writes Redis directly, to look at and tamper with what the app cached. */
async function withRaw<T>(
  use: (client: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    ttl(key: string): Promise<number>;
  }) => Promise<T>,
): Promise<T> {
  const client = createClient({ url: testRedisUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.quit();
  }
}
const rawGet = (key: string) => withRaw((c) => c.get(key));
const rawSet = (key: string, value: string) => withRaw((c) => c.set(key, value));
const rawTtl = (key: string) => withRaw((c) => c.ttl(key));

describe('the route matrix cache in Redis', () => {
  it('serves a second solve from Redis: Postgres is not needed and Google is not asked', async () => {
    const { maps, addStage, solve } = await setup(redis);
    await addStage(10);
    await addStage(20);
    await solve();
    maps.routeMatrix.mockClear();
    await db.delete(routeMatrixCache); // only Redis still has it

    const again = await solve();

    expect(again.status).toBe(200);
    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });

  it('keeps the cache for a day (it expires by itself)', async () => {
    const { addStage, solve, key } = await setup(redis);
    await addStage(10);
    await solve();

    const ttl = await rawTtl(key);

    expect(ttl).toBeGreaterThan(23 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('fills Redis from Postgres on a miss', async () => {
    const { agent, day, addStage, solve, key } = await setup(redis);
    await addStage(10);
    await solve();
    await redis.flush();

    const saved = await agent.get(`/days/${day.id}/route`); // reads the cache

    expect(saved.status).toBe(200);
    expect(await rawGet(key)).not.toBeNull();
  });

  it('never pays Google because Redis is behind: a missing pair is looked up in Postgres first', async () => {
    const { maps, addStage, solve, key } = await setup(redis);
    await addStage(10);
    await addStage(20);
    await solve();
    const old = await rawGet(key); // knows two stops
    await addStage(30);
    await solve(); // Postgres and Redis now know three
    maps.routeMatrix.mockClear();
    await rawSet(key, old!); // Redis goes back to the old value

    const again = await solve();

    expect(again.status).toBe(200);
    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });

  it('shows the saved route when only Redis has the matrix, and a stale Redis does not answer "needs a new solve"', async () => {
    const { agent, day, addStage, solve, key } = await setup(redis);
    await addStage(10);
    await addStage(20);
    await solve();
    const old = await rawGet(key);
    await addStage(30);
    await solve();
    await rawSet(key, old!);

    const saved = await agent.get(`/days/${day.id}/route`);

    expect(saved.status).toBe(200); // Postgres had every pair
  });
});

describe('the same answers with Redis up, down and off', () => {
  const stubDown: RedisHandle = {
    isReady: false,
    get: async () => null,
    set: async () => undefined,
    incrementWindow: async () => 1,
  };

  async function run(redisDep: RedisHandle | undefined) {
    await resetDb(db);
    await redis.flush();
    const { maps, addStage, solve, day } = await setup(redisDep);
    await addStage(10);
    await addStage(25);
    await addStage(15);
    const first = await solve();
    const second = await solve();
    const rows = await db.select().from(routeMatrixCache);
    return {
      first: first.body,
      second: second.body,
      calls: maps.routeMatrix.mock.calls.length,
      rows: rows.length,
      dayId: day.id,
    };
  }

  it('gives identical routes and the same number of Google calls', async () => {
    const up = await run(redis);
    const down = await run(stubDown);
    const off = await run(undefined);

    for (const other of [down, off]) {
      expect(other.first.order).toHaveLength(3);
      expect(other.first.visits.map((v: { arrival: number }) => v.arrival)).toEqual(
        up.first.visits.map((v: { arrival: number }) => v.arrival),
      );
      expect(other.first.endArrival).toBe(up.first.endArrival);
      expect(other.second.endArrival).toBe(up.second.endArrival);
      expect(other.calls).toBe(up.calls);
      expect(other.rows).toBe(1); // Postgres always keeps the truth
    }
  });
});
