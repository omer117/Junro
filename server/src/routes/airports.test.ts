import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAirports } from '../airports/seed.js';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp, signInAs } from '../test-app.js';

const { db, pool } = createDb(testDatabaseUrl);
const app = createTestApp(db);

// The airports are reference data: loaded once, and never cleared between tests.
beforeAll(async () => {
  await seedAirports(db);
});
beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const search = async (q: string, extra = '') => {
  const { agent } = await signInAs(db, app);
  return agent.get(`/airports?q=${encodeURIComponent(q)}${extra}`);
};

describe('GET /airports', () => {
  it('requires sign-in', async () => {
    await request(app).get('/airports?q=tlv').expect(401);
  });

  it('finds an airport by its IATA code, and puts the exact code first', async () => {
    const res = await search('TLV');

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({
      iata: 'TLV',
      name: 'Ben Gurion International Airport',
      city: 'Tel Aviv',
      countryCode: 'IL',
      countryName: 'Israel',
    });
  });

  it('is not case sensitive', async () => {
    const res = await search('tlv');

    expect(res.body[0].iata).toBe('TLV');
  });

  it('finds airports by city', async () => {
    const res = await search('tokyo');

    const codes = res.body.map((a: { iata: string }) => a.iata);
    expect(codes).toContain('HND');
  });

  it('finds airports by country, the biggest first', async () => {
    const res = await search('japan');

    const codes = res.body.map((a: { iata: string }) => a.iata);
    expect(codes.length).toBeGreaterThan(1);
    expect(codes.slice(0, 5)).toContain('NRT');
    expect(res.body.every((a: { countryName: string }) => a.countryName === 'Japan')).toBe(true);
  });

  it('answers with a short list: 8 by default, at most 20', async () => {
    expect((await search('airport')).body.length).toBeLessThanOrEqual(8);
    const more = await search('airport', '&limit=20');
    expect(more.body.length).toBeGreaterThan(8);
    expect(more.body.length).toBeLessThanOrEqual(20);
    expect((await search('airport', '&limit=500')).status).toBe(400);
  });

  it('gives an empty list when nothing matches', async () => {
    const res = await search('zzzzqqqq');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(['', 'a', '  '])('refuses a search that is too short (%j)', async (q) => {
    const res = await search(q);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('treats % and _ as ordinary characters, not as wildcards', async () => {
    const res = await search('%%');

    expect(res.body).toEqual([]);
  });
});
