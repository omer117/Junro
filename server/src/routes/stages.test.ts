import { MAX_STAGES } from '@junro/solver';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp, signInAs } from '../test-app.js';

const { db, pool } = createDb(testDatabaseUrl);
const app = createTestApp(db);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const validDay = {
  date: '2027-04-01',
  start: { lat: 35.68, lng: 139.76 },
  end: { lat: 35.68, lng: 139.76 },
  startTime: 540,
  travelMode: 'walking',
};

async function newPlace(googlePlaceId = 'p-1', name = 'Senso-ji') {
  const [place] = await db
    .insert(places)
    .values({ googlePlaceId, name, lat: 35.71, lng: 139.8 })
    .returning();
  return place!;
}

async function userWithDay(name = 'Ann') {
  const { agent, user } = await signInAs(db, app, name);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(validDay);
  return { agent, user, day };
}

describe('stages API', () => {
  it('requires sign-in', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    await request(app).get(`/days/${id}/stages`).expect(401);
    await request(app).post(`/days/${id}/stages`).send({}).expect(401);
    await request(app).get(`/stages/${id}`).expect(401);
    await request(app).patch(`/stages/${id}`).send({}).expect(401);
    await request(app).delete(`/stages/${id}`).expect(401);
  });

  it('adds a stage with its place and sensible defaults', async () => {
    const { agent, day } = await userWithDay();
    const place = await newPlace();

    const res = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'temple' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      dayId: day.id,
      category: 'temple',
      stayOverrideMinutes: null,
      done: false,
      position: null,
      place: { id: place.id, googlePlaceId: 'p-1', name: 'Senso-ji', lat: 35.71, lng: 139.8 },
    });
  });

  it('accepts a stay override for one stage', async () => {
    const { agent, day } = await userWithDay();
    const place = await newPlace();

    const res = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'museum', stayOverrideMinutes: 150 });

    expect(res.body.stayOverrideMinutes).toBe(150);
  });

  it('rejects a place that does not exist', async () => {
    const { agent, day } = await userWithDay();

    const res = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: '00000000-0000-0000-0000-000000000000', category: 'temple' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unknown_place');
  });

  it.each([
    ['unknown category', { category: 'spaceport' }],
    ['zero override', { stayOverrideMinutes: 0 }],
    ['fractional override', { stayOverrideMinutes: 10.5 }],
    ['override over a day', { stayOverrideMinutes: 1441 }],
    ['place id that is not a uuid', { placeId: 'nope' }],
  ])('rejects %s', async (_name, change) => {
    const { agent, day } = await userWithDay();
    const place = await newPlace();

    const res = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'temple', ...change });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('refuses a stage beyond what the solver can handle', async () => {
    const { agent, day } = await userWithDay();
    const place = await newPlace();
    for (let i = 0; i < MAX_STAGES; i++) {
      await agent
        .post(`/days/${day.id}/stages`)
        .send({ placeId: place.id, category: 'park' })
        .expect(201);
    }

    const res = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'park' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('day_full');
  });

  it('lists the stages of my day in the order they were added', async () => {
    const { agent, day } = await userWithDay();
    const a = await newPlace('p-a', 'A');
    const b = await newPlace('p-b', 'B');
    await agent.post(`/days/${day.id}/stages`).send({ placeId: a.id, category: 'park' });
    await agent.post(`/days/${day.id}/stages`).send({ placeId: b.id, category: 'cafe' });

    const res = await agent.get(`/days/${day.id}/stages`);

    expect(res.status).toBe(200);
    expect(res.body.map((s: { place: { name: string } }) => s.place.name)).toEqual(['A', 'B']);
  });

  it('gets, updates and deletes my stage', async () => {
    const { agent, day } = await userWithDay();
    const place = await newPlace();
    const { body: stage } = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'temple', stayOverrideMinutes: 45 });

    expect((await agent.get(`/stages/${stage.id}`)).body).toEqual(stage);

    const updated = await agent
      .patch(`/stages/${stage.id}`)
      .send({ category: 'museum', done: true, stayOverrideMinutes: 90 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ category: 'museum', done: true, stayOverrideMinutes: 90 });

    // null removes the override, so the user's preference applies again.
    const cleared = await agent.patch(`/stages/${stage.id}`).send({ stayOverrideMinutes: null });
    expect(cleared.body.stayOverrideMinutes).toBeNull();

    await agent.delete(`/stages/${stage.id}`).expect(204);
    await agent.get(`/stages/${stage.id}`).expect(404);
  });

  it('keeps the place when a stage is deleted (places are shared)', async () => {
    const { agent, day } = await userWithDay();
    const place = await newPlace();
    const { body: stage } = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'temple' });

    await agent.delete(`/stages/${stage.id}`).expect(204);

    expect(await db.select().from(places)).toHaveLength(1);
  });

  it("answers 404 for someone else's day and stages", async () => {
    const ann = await userWithDay('Ann');
    const bob = await signInAs(db, app, 'Bob');
    const place = await newPlace();
    const { body: stage } = await ann.agent
      .post(`/days/${ann.day.id}/stages`)
      .send({ placeId: place.id, category: 'temple' });

    await bob.agent.get(`/days/${ann.day.id}/stages`).expect(404);
    await bob.agent
      .post(`/days/${ann.day.id}/stages`)
      .send({ placeId: place.id, category: 'temple' })
      .expect(404);
    await bob.agent.get(`/stages/${stage.id}`).expect(404);
    await bob.agent.patch(`/stages/${stage.id}`).send({ done: true }).expect(404);
    await bob.agent.delete(`/stages/${stage.id}`).expect(404);

    expect((await ann.agent.get(`/stages/${stage.id}`)).body.done).toBe(false);
  });
});
