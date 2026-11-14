import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { GoogleUnavailableError } from '../google/errors.js';
import { createUsageGuard } from '../google/guard.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const suggestions = [{ googlePlaceId: 'abc', text: 'Senso-ji, Asakusa' }];
const search = (agent: request.Agent, q: string, sessionToken = 'session-token-1') =>
  agent.get('/places/search').query({ q, sessionToken });

const usedAutocomplete = async () =>
  (
    await createUsageGuard({
      db,
      caps: {
        autocomplete: 1e9,
        placeDetails: 1e9,
        routeMatrix: 1e9,
        computeRoutes: 1e9,
        transitMatrix: 1e9,
        transitRoutes: 1e9,
      },
    }).usage()
  ).autocomplete;

async function setup(overrides: Parameters<typeof createTestApp>[1] = {}) {
  const maps = fakeMaps({ autocomplete: async () => suggestions });
  const app = createTestApp(db, { maps, ...overrides });
  const { agent } = await signInAs(db, app);
  return { maps, app, agent };
}

describe('GET /places/search', () => {
  it('requires sign-in, and never calls Google for an anonymous request', async () => {
    const { maps, app } = await setup();

    await request(app)
      .get('/places/search')
      .query({ q: 'senso', sessionToken: 's-123456' })
      .expect(401);

    expect(maps.autocomplete).not.toHaveBeenCalled();
  });

  it('returns suggestions from Google', async () => {
    const { agent, maps } = await setup();

    const res = await search(agent, 'senso');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(suggestions);
    expect(maps.autocomplete).toHaveBeenCalledWith({
      query: 'senso',
      sessionToken: 'session-token-1',
    });
    expect(await usedAutocomplete()).toBe(1);
  });

  it.each([
    ['too short', { q: 'ab', sessionToken: 'session-token-1' }],
    ['only spaces', { q: '    ', sessionToken: 'session-token-1' }],
    ['too long', { q: 'x'.repeat(101), sessionToken: 'session-token-1' }],
    ['no session token', { q: 'senso' }],
    ['short session token', { q: 'senso', sessionToken: 'abc' }],
  ])('refuses a search that is %s without calling Google', async (_name, query) => {
    const { agent, maps } = await setup();

    const res = await agent.get('/places/search').query(query);

    expect(res.status).toBe(400);
    expect(maps.autocomplete).not.toHaveBeenCalled();
    expect(await usedAutocomplete()).toBe(0);
  });

  it('answers a repeated search from memory: no Google call, no quota used', async () => {
    const { agent, maps } = await setup();

    await search(agent, 'senso');
    const again = await search(agent, '  Senso ', 'another-session-token');

    expect(again.body).toEqual(suggestions);
    expect(maps.autocomplete).toHaveBeenCalledTimes(1);
    expect(await usedAutocomplete()).toBe(1);
  });

  it('stops before Google when the monthly cap is reached', async () => {
    const { agent, maps } = await setup({
      quotaCaps: {
        autocomplete: 1,
        placeDetails: 1,
        routeMatrix: 1,
        computeRoutes: 1,
        transitMatrix: 1,
        transitRoutes: 1,
      },
    });
    await search(agent, 'first').expect(200);

    const res = await search(agent, 'second');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('quota_reached');
    expect(maps.autocomplete).toHaveBeenCalledTimes(1);
  });

  it('does not search at all when the cap is 0 (switched off)', async () => {
    const { agent, maps } = await setup({
      quotaCaps: {
        autocomplete: 0,
        placeDetails: 1,
        routeMatrix: 1,
        computeRoutes: 1,
        transitMatrix: 1,
        transitRoutes: 1,
      },
    });

    await search(agent, 'senso').expect(429);

    expect(maps.autocomplete).not.toHaveBeenCalled();
  });

  it('limits how fast one user can search', async () => {
    const { agent, maps } = await setup({ searchRateLimit: 3 });

    const statuses = [];
    for (const q of ['aaa', 'bbb', 'ccc', 'ddd']) statuses.push((await search(agent, q)).status);

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(maps.autocomplete).toHaveBeenCalledTimes(3);
  });

  it('shows a clear error when Google is down, and does not cache the failure', async () => {
    let fail = true;
    const maps = fakeMaps({
      autocomplete: async () => {
        if (fail) throw new GoogleUnavailableError();
        return suggestions;
      },
    });
    const app = createTestApp(db, { maps });
    const { agent } = await signInAs(db, app);

    const down = await search(agent, 'senso');
    expect(down.status).toBe(502);
    expect(down.body.error.code).toBe('google_unavailable');

    fail = false;
    expect((await search(agent, 'senso')).body).toEqual(suggestions);
  });

  it('answers 503 when no Google key is configured', async () => {
    const app = createTestApp(db);
    const { agent } = await signInAs(db, app);

    const res = await search(agent, 'senso');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('google_not_configured');
  });

  describe('near a place', () => {
    it('tells Google where the person is looking, so results come from around there', async () => {
      const { maps, agent } = await setup();

      await search(agent, 'shinjuku station').query({ lat: 35.69, lng: 139.7 }).expect(200);

      expect(maps.autocomplete.mock.calls[0]![0].near).toEqual({ lat: 35.69, lng: 139.7 });
    });

    it('keeps results for one area apart from results for another, but shares them nearby', async () => {
      const { maps, agent } = await setup();

      await search(agent, 'station').query({ lat: 35.69, lng: 139.7 }).expect(200);
      await search(agent, 'station').query({ lat: 35.691, lng: 139.701 }).expect(200); // same area
      await search(agent, 'station').query({ lat: 40.7, lng: -74 }).expect(200); // elsewhere
      await search(agent, 'station').expect(200); // anywhere

      expect(maps.autocomplete).toHaveBeenCalledTimes(3);
    });

    it('refuses a place with only one of its two numbers, before Google', async () => {
      const { maps, agent } = await setup();

      await search(agent, 'station').query({ lat: 35.69 }).expect(400);
      await search(agent, 'station').query({ lat: 200, lng: 10 }).expect(400);

      expect(maps.autocomplete).not.toHaveBeenCalled();
    });
  });
});
