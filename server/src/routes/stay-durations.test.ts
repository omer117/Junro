import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { CATEGORIES } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { SYSTEM_MINIMUM_STAY } from '../stay.js';
import { createTestApp, signInAs } from '../test-app.js';

const { db, pool } = createDb(testDatabaseUrl);
const app = createTestApp(db);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const museumMin = SYSTEM_MINIMUM_STAY.museum;

describe('stay durations API', () => {
  it('requires sign-in', async () => {
    await request(app).get('/me/stay-durations').expect(401);
    await request(app).put('/me/stay-durations/museum').send({ stayMinutes: 90 }).expect(401);
    await request(app).delete('/me/stay-durations/museum').expect(401);
  });

  it('lists every category with its minimum and no preference at first', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent.get('/me/stay-durations');

    expect(res.status).toBe(200);
    expect(res.body.map((c: { category: string }) => c.category)).toEqual([...CATEGORIES]);
    expect(res.body.find((c: { category: string }) => c.category === 'museum')).toEqual({
      category: 'museum',
      minimumMinutes: museumMin,
      preferenceMinutes: null,
    });
  });

  it('saves a preference and shows it in the list', async () => {
    const { agent } = await signInAs(db, app);

    const put = await agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin + 45 });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({
      category: 'museum',
      minimumMinutes: museumMin,
      preferenceMinutes: museumMin + 45,
    });

    const list = await agent.get('/me/stay-durations');
    const museum = list.body.find((c: { category: string }) => c.category === 'museum');
    expect(museum.preferenceMinutes).toBe(museumMin + 45);
  });

  it('changes an existing preference instead of adding a second one', async () => {
    const { agent } = await signInAs(db, app);
    await agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin + 10 });

    const res = await agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin + 20 });

    expect(res.body.preferenceMinutes).toBe(museumMin + 20);
  });

  it('accepts exactly the minimum', async () => {
    const { agent } = await signInAs(db, app);

    await agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin }).expect(200);
  });

  it('refuses a preference below the system minimum', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin - 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('below_minimum');
    expect(res.body.error.message).toContain(String(museumMin));
    const list = await agent.get('/me/stay-durations');
    expect(
      list.body.find((c: { category: string }) => c.category === 'museum').preferenceMinutes,
    ).toBeNull();
  });

  it.each([{}, { stayMinutes: 'long' }, { stayMinutes: 60.5 }, { stayMinutes: 1441 }])(
    'rejects an invalid body %j',
    async (body) => {
      const { agent } = await signInAs(db, app);

      const res = await agent.put('/me/stay-durations/museum').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    },
  );

  it('answers 404 for an unknown category', async () => {
    const { agent } = await signInAs(db, app);

    await agent.put('/me/stay-durations/spaceport').send({ stayMinutes: 90 }).expect(404);
    await agent.delete('/me/stay-durations/spaceport').expect(404);
  });

  it('resets a preference back to the default', async () => {
    const { agent } = await signInAs(db, app);
    await agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin + 45 });

    await agent.delete('/me/stay-durations/museum').expect(204);
    await agent.delete('/me/stay-durations/museum').expect(204); // already reset: still fine

    const list = await agent.get('/me/stay-durations');
    expect(
      list.body.find((c: { category: string }) => c.category === 'museum').preferenceMinutes,
    ).toBeNull();
  });

  it("never shows or changes another user's preferences", async () => {
    const ann = await signInAs(db, app, 'Ann');
    const bob = await signInAs(db, app, 'Bob');
    await ann.agent.put('/me/stay-durations/museum').send({ stayMinutes: museumMin + 45 });

    const bobList = await bob.agent.get('/me/stay-durations');
    expect(
      bobList.body.every((c: { preferenceMinutes: number | null }) => c.preferenceMinutes === null),
    ).toBe(true);

    await bob.agent.delete('/me/stay-durations/museum').expect(204);
    const annList = await ann.agent.get('/me/stay-durations');
    expect(
      annList.body.find((c: { category: string }) => c.category === 'museum').preferenceMinutes,
    ).toBe(museumMin + 45);
  });
});
