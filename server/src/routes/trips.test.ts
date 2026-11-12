import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp, signInAs } from '../test-app.js';

const { db, pool } = createDb(testDatabaseUrl);
const app = createTestApp(db);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

describe('trips API', () => {
  it('requires sign-in on every route', async () => {
    await request(app).get('/trips').expect(401);
    await request(app).post('/trips').send({ name: 'x' }).expect(401);
    await request(app).get('/trips/00000000-0000-0000-0000-000000000000').expect(401);
    await request(app).patch('/trips/00000000-0000-0000-0000-000000000000').expect(401);
    await request(app).delete('/trips/00000000-0000-0000-0000-000000000000').expect(401);
  });

  it('creates a trip owned by the signed-in user', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent.post('/trips').send({ name: 'Japan' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Japan' });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body).not.toHaveProperty('userId');
  });

  it.each([{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(101) }, { name: 5 }])(
    'rejects an invalid body %j',
    async (body) => {
      const { agent } = await signInAs(db, app);

      const res = await agent.post('/trips').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    },
  );

  it('lists only my trips, newest first', async () => {
    const ann = await signInAs(db, app, 'Ann');
    const bob = await signInAs(db, app, 'Bob');
    await ann.agent.post('/trips').send({ name: 'First' });
    await ann.agent.post('/trips').send({ name: 'Second' });
    await bob.agent.post('/trips').send({ name: 'Bobs' });

    const res = await ann.agent.get('/trips');

    expect(res.status).toBe(200);
    expect(res.body.map((t: { name: string }) => t.name)).toEqual(['Second', 'First']);
  });

  it('gets, renames and deletes my trip', async () => {
    const { agent } = await signInAs(db, app);
    const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });

    expect((await agent.get(`/trips/${trip.id}`)).body.name).toBe('Japan');

    const renamed = await agent.patch(`/trips/${trip.id}`).send({ name: 'Kyoto' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Kyoto');

    await agent.delete(`/trips/${trip.id}`).expect(204);
    await agent.get(`/trips/${trip.id}`).expect(404);
  });

  it("answers 404 (not 403) for someone else's trip, and changes nothing", async () => {
    const ann = await signInAs(db, app, 'Ann');
    const bob = await signInAs(db, app, 'Bob');
    const { body: trip } = await ann.agent.post('/trips').send({ name: 'Private' });

    await bob.agent.get(`/trips/${trip.id}`).expect(404);
    await bob.agent.patch(`/trips/${trip.id}`).send({ name: 'Hacked' }).expect(404);
    await bob.agent.delete(`/trips/${trip.id}`).expect(404);

    expect((await ann.agent.get(`/trips/${trip.id}`)).body.name).toBe('Private');
  });

  it('answers 404 for an id that is not a uuid', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent.get('/trips/not-a-uuid');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
