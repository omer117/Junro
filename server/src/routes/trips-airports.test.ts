import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedAirports } from '../airports/seed.js';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp, signInAs } from '../test-app.js';

const { db, pool } = createDb(testDatabaseUrl);
const app = createTestApp(db);

beforeAll(async () => {
  await seedAirports(db);
});
beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const TLV = {
  iata: 'TLV',
  name: 'Ben Gurion International Airport',
  city: 'Tel Aviv',
  countryCode: 'IL',
  countryName: 'Israel',
};

describe('the route of a trip (origin and destination airports)', () => {
  it('has no airports until they are set', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent.post('/trips').send({ name: 'Japan' });

    expect(res.status).toBe(201);
    expect(res.body.origin).toBeNull();
    expect(res.body.destination).toBeNull();
  });

  it('is created with an origin and a destination, written out for the client', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent
      .post('/trips')
      .send({ name: 'Japan', originAirport: 'TLV', destinationAirport: 'HND' });

    expect(res.status).toBe(201);
    expect(res.body.origin).toEqual(TLV);
    expect(res.body.destination).toMatchObject({ iata: 'HND', city: 'Tokyo' });
  });

  it('accepts a code in lower case', async () => {
    const { agent } = await signInAs(db, app);

    const res = await agent.post('/trips').send({ name: 'Japan', originAirport: 'tlv' });

    expect(res.body.origin.iata).toBe('TLV');
  });

  it.each([
    ['an airport that is not in the list', { originAirport: 'QQQ' }],
    ['something that is not a code', { destinationAirport: 'Tokyo' }],
    ['the same airport twice', { originAirport: 'TLV', destinationAirport: 'TLV' }],
  ])('refuses %s', async (_name, airports) => {
    const { agent } = await signInAs(db, app);

    const res = await agent.post('/trips').send({ name: 'Japan', ...airports });

    expect(res.status).toBe(400);
    expect(['unknown_airport', 'validation_error', 'same_airport']).toContain(res.body.error.code);
  });

  it('is shown in the list and in the single trip', async () => {
    const { agent } = await signInAs(db, app);
    const { body: trip } = await agent
      .post('/trips')
      .send({ name: 'Japan', originAirport: 'TLV', destinationAirport: 'HND' });

    expect((await agent.get('/trips')).body[0].origin.iata).toBe('TLV');
    expect((await agent.get(`/trips/${trip.id}`)).body.destination.iata).toBe('HND');
  });

  it('can be set, changed and cleared afterwards, without touching the name', async () => {
    const { agent } = await signInAs(db, app);
    const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });

    const set = await agent
      .patch(`/trips/${trip.id}`)
      .send({ originAirport: 'TLV', destinationAirport: 'HND' });
    expect(set.body).toMatchObject({ name: 'Japan', origin: { iata: 'TLV' } });

    const changed = await agent.patch(`/trips/${trip.id}`).send({ destinationAirport: 'KIX' });
    expect(changed.body.destination.iata).toBe('KIX');
    expect(changed.body.origin.iata).toBe('TLV');

    const cleared = await agent.patch(`/trips/${trip.id}`).send({ originAirport: null });
    expect(cleared.body.origin).toBeNull();
    expect(cleared.body.destination.iata).toBe('KIX');
  });

  it('refuses a change that would make origin and destination the same', async () => {
    const { agent } = await signInAs(db, app);
    const { body: trip } = await agent
      .post('/trips')
      .send({ name: 'Japan', originAirport: 'TLV', destinationAirport: 'HND' });

    const res = await agent.patch(`/trips/${trip.id}`).send({ destinationAirport: 'TLV' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('same_airport');
  });

  it('a rename alone still works as before', async () => {
    const { agent } = await signInAs(db, app);
    const { body: trip } = await agent.post('/trips').send({ name: 'Japan', originAirport: 'TLV' });

    const res = await agent.patch(`/trips/${trip.id}`).send({ name: 'Kyoto' });

    expect(res.body).toMatchObject({ name: 'Kyoto', origin: { iata: 'TLV' } });
  });

  it('refuses an empty change', async () => {
    const { agent } = await signInAs(db, app);
    const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });

    await agent.patch(`/trips/${trip.id}`).send({}).expect(400);
  });
});
