import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
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

async function userWithTrip(name = 'Ann') {
  const { agent, user } = await signInAs(db, app, name);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  return { agent, user, trip };
}

describe('days API', () => {
  it('requires sign-in', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    await request(app).get(`/trips/${id}/days`).expect(401);
    await request(app).post(`/trips/${id}/days`).send(validDay).expect(401);
    await request(app).get(`/days/${id}`).expect(401);
    await request(app).patch(`/days/${id}`).send({}).expect(401);
    await request(app).delete(`/days/${id}`).expect(401);
  });

  it('creates a day in my trip', async () => {
    const { agent, trip } = await userWithTrip();

    const res = await agent.post(`/trips/${trip.id}/days`).send(validDay);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      tripId: trip.id,
      ...validDay,
      startName: null,
      endName: null,
      stageCount: 0,
    });
  });

  it.each([
    ['bad date', { date: '2027-13-40' }],
    ['date with time', { date: '2027-04-01T10:00:00Z' }],
    ['latitude out of range', { start: { lat: 91, lng: 0 } }],
    ['longitude out of range', { end: { lat: 0, lng: 181 } }],
    ['start time past midnight', { startTime: 1440 }],
    ['negative start time', { startTime: -1 }],
    ['fractional start time', { startTime: 540.5 }],
    ['unknown travel mode', { travelMode: 'teleport' }],
    ['missing start', { start: undefined }],
  ])('rejects %s', async (_name, change) => {
    const { agent, trip } = await userWithTrip();

    const res = await agent.post(`/trips/${trip.id}/days`).send({ ...validDay, ...change });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('lists the days of my trip in date order', async () => {
    const { agent, trip } = await userWithTrip();
    await agent.post(`/trips/${trip.id}/days`).send({ ...validDay, date: '2027-04-03' });
    await agent.post(`/trips/${trip.id}/days`).send({ ...validDay, date: '2027-04-01' });

    const res = await agent.get(`/trips/${trip.id}/days`);

    expect(res.status).toBe(200);
    expect(res.body.map((d: { date: string }) => d.date)).toEqual(['2027-04-01', '2027-04-03']);
  });

  it('gets, partly updates and deletes my day', async () => {
    const { agent, trip } = await userWithTrip();
    const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(validDay);

    expect((await agent.get(`/days/${day.id}`)).body).toEqual(day);

    const changed = await agent
      .patch(`/days/${day.id}`)
      .send({ startTime: 600, travelMode: 'driving', end: { lat: 34.99, lng: 135.75 } });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({
      ...day,
      startTime: 600,
      travelMode: 'driving',
      end: { lat: 34.99, lng: 135.75 },
    });

    await agent.delete(`/days/${day.id}`).expect(204);
    await agent.get(`/days/${day.id}`).expect(404);
  });

  it('an empty PATCH changes nothing', async () => {
    const { agent, trip } = await userWithTrip();
    const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(validDay);

    const res = await agent.patch(`/days/${day.id}`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(day);
  });

  it('deleting a trip deletes its days', async () => {
    const { agent, trip } = await userWithTrip();
    const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(validDay);

    await agent.delete(`/trips/${trip.id}`).expect(204);

    await agent.get(`/days/${day.id}`).expect(404);
  });

  it("answers 404 for someone else's trip and days", async () => {
    const ann = await userWithTrip('Ann');
    const bob = await signInAs(db, app, 'Bob');
    const { body: day } = await ann.agent.post(`/trips/${ann.trip.id}/days`).send(validDay);

    await bob.agent.get(`/trips/${ann.trip.id}/days`).expect(404);
    await bob.agent.post(`/trips/${ann.trip.id}/days`).send(validDay).expect(404);
    await bob.agent.get(`/days/${day.id}`).expect(404);
    await bob.agent.patch(`/days/${day.id}`).send({ startTime: 1 }).expect(404);
    await bob.agent.delete(`/days/${day.id}`).expect(404);

    expect((await ann.agent.get(`/days/${day.id}`)).body.startTime).toBe(540);
  });

  it('answers 404 for ids that are not uuids', async () => {
    const { agent } = await userWithTrip();

    await agent.get('/days/nope').expect(404);
    await agent.get('/trips/nope/days').expect(404);
  });
});

describe('names for the two ends of a day', () => {
  it('has no names until they are given, and says so', async () => {
    const { agent, trip } = await userWithTrip();

    const res = await agent.post(`/trips/${trip.id}/days`).send(validDay);

    expect(res.body.startName).toBeNull();
    expect(res.body.endName).toBeNull();
  });

  it('keeps the names given when the day is created, and lets them change', async () => {
    const { agent, trip } = await userWithTrip();
    const { body: day } = await agent
      .post(`/trips/${trip.id}/days`)
      .send({ ...validDay, startName: 'Hotel Gracery', endName: 'Hotel Gracery' });

    expect(day).toMatchObject({ startName: 'Hotel Gracery', endName: 'Hotel Gracery' });

    const changed = await agent.patch(`/days/${day.id}`).send({ endName: 'Ueno station' });
    expect(changed.body).toMatchObject({ startName: 'Hotel Gracery', endName: 'Ueno station' });

    const cleared = await agent.patch(`/days/${day.id}`).send({ startName: null });
    expect(cleared.body.startName).toBeNull();
    expect(cleared.body.endName).toBe('Ueno station');
  });

  it.each([{ startName: '' }, { startName: '   ' }, { endName: 'x'.repeat(101) }, { endName: 5 }])(
    'refuses the name %j',
    async (names) => {
      const { agent, trip } = await userWithTrip();

      const res = await agent.post(`/trips/${trip.id}/days`).send({ ...validDay, ...names });

      expect(res.status).toBe(400);
    },
  );
});
