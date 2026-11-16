import type { LatLng } from '@junro/solver';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng)));

const stayBody = {
  name: 'Tokyo',
  firstDate: '2027-04-01',
  dayCount: 3,
  hotel: { lat: 10, lng: 0 },
  hotelName: 'Hotel Gracery',
  travelMode: 'walking',
  startTime: 540,
};

let counter = 0;
async function setup() {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    computeRoute: async () => 'LINE',
  });
  const app = createTestApp(db, { maps });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const makePlace = async (x: number) => {
    counter += 1;
    const [place] = await db
      .insert(places)
      .values({ googlePlaceId: `ChIJ-seg-${counter}`, name: `Place ${x}`, lat: 10, lng: x })
      .returning();
    return place!;
  };
  const createStay = async (extra: Record<string, unknown> = {}) =>
    agent.post(`/trips/${trip.id}/segments`).send({ ...stayBody, ...extra });
  const addToPool = async (segmentId: string, x: number, extra: Record<string, unknown> = {}) => {
    const place = await makePlace(x);
    return agent.post(`/segments/${segmentId}/stages`).send({
      placeId: place.id,
      category: 'park',
      ...extra,
    });
  };
  return { app, agent, trip, createStay, addToPool, makePlace };
}

describe('a stay (segment)', () => {
  it('creates its days, one per date, starting and ending at the hotel', async () => {
    const { agent, createStay } = await setup();

    const res = await createStay();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Tokyo', firstDate: '2027-04-01', dayCount: 3 });
    const detail = await agent.get(`/segments/${res.body.id}`);
    expect(detail.body.days.map((d: { date: string }) => d.date)).toEqual([
      '2027-04-01',
      '2027-04-02',
      '2027-04-03',
    ]);
    expect(detail.body.days[0]).toMatchObject({
      segmentId: res.body.id,
      start: { lat: 10, lng: 0 },
      end: { lat: 10, lng: 0 },
      startName: 'Hotel Gracery',
      startTime: 540,
    });
  });

  it('refuses 0 or more than 10 days, and an end time before the start', async () => {
    const { createStay } = await setup();

    expect((await createStay({ dayCount: 0 })).status).toBe(400);
    expect((await createStay({ dayCount: 11 })).status).toBe(400);
    expect((await createStay({ endTime: 500 })).status).toBe(400);
  });

  it('refuses a stay that shares a date with another stay of the trip (409)', async () => {
    const { createStay } = await setup();
    await createStay();

    const res = await createStay({ name: 'Kyoto', firstDate: '2027-04-03', dayCount: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('segment_overlap');
    expect((await createStay({ name: 'Kyoto', firstDate: '2027-04-04' })).status).toBe(201);
  });

  it('lists the stays of a trip, and deleting one removes its days and places', async () => {
    const { agent, trip, createStay, addToPool } = await setup();
    const stay = (await createStay()).body;
    await addToPool(stay.id, 10);

    const list = await agent.get(`/trips/${trip.id}/segments`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ dayCount: 3, placeCount: 1 });

    await agent.delete(`/segments/${stay.id}`).expect(204);
    expect((await agent.get(`/trips/${trip.id}/days`)).body).toEqual([]);
    expect((await agent.get(`/segments/${stay.id}`)).status).toBe(404);
  });

  it('is invisible to other users (404), including its pool and its places', async () => {
    const { app, createStay, addToPool } = await setup();
    const stay = (await createStay()).body;
    const place = (await addToPool(stay.id, 10)).body;
    const bob = await signInAs(db, app, 'Bob');

    expect((await bob.agent.get(`/segments/${stay.id}`)).status).toBe(404);
    expect((await bob.agent.get(`/segments/${stay.id}/pool`)).status).toBe(404);
    const valid = {
      placeId: place.place.id,
      category: 'park',
    };
    expect((await bob.agent.post(`/segments/${stay.id}/stages`).send(valid)).status).toBe(404);
    expect(
      (await bob.agent.patch(`/stages/${place.id}`).send({ priority: 'optional' })).status,
    ).toBe(404);
    expect((await bob.agent.delete(`/segments/${stay.id}`)).status).toBe(404);
  });

  it('limits the places of a stay to 15 a day (60 at most)', async () => {
    const { createStay, addToPool } = await setup();
    const stay = (await createStay({ dayCount: 1 })).body;
    for (let i = 0; i < 15; i++) expect((await addToPool(stay.id, i)).status).toBe(201);

    const res = await addToPool(stay.id, 99);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('stay_full');
  });
});

describe('the pool and moving places between days', () => {
  it('keeps pool stages out of the days, with their priority and category', async () => {
    const { agent, createStay, addToPool } = await setup();
    const stay = (await createStay()).body;
    const a = (await addToPool(stay.id, 10, { priority: 'optional' })).body;

    const pool = await agent.get(`/segments/${stay.id}/pool`);

    expect(pool.body).toHaveLength(1);
    expect(pool.body[0]).toMatchObject({
      id: a.id,
      dayId: null,
      segmentId: stay.id,
      priority: 'optional',
    });
    const detail = await agent.get(`/segments/${stay.id}`);
    expect(detail.body.days.every((d: { stageCount: number }) => d.stageCount === 0)).toBe(true);
  });

  it('moves a place from the pool to a day of the stay and back, keeping its id', async () => {
    const { agent, createStay, addToPool } = await setup();
    const stay = (await createStay()).body;
    const day = (await agent.get(`/segments/${stay.id}`)).body.days[1];
    const a = (await addToPool(stay.id, 10)).body;

    const onDay = await agent.patch(`/stages/${a.id}`).send({ dayId: day.id });
    expect(onDay.body).toMatchObject({ id: a.id, dayId: day.id, segmentId: stay.id });
    expect((await agent.get(`/days/${day.id}/stages`)).body).toHaveLength(1);

    const back = await agent.patch(`/stages/${a.id}`).send({ dayId: null });
    expect(back.body).toMatchObject({ id: a.id, dayId: null, segmentId: stay.id });
    expect((await agent.get(`/segments/${stay.id}/pool`)).body).toHaveLength(1);
  });

  it('refuses a day of another stay, a standalone place, and a full day', async () => {
    const { agent, trip, createStay, addToPool, makePlace } = await setup();
    const stay = (await createStay({ dayCount: 1 })).body;
    const other = (await createStay({ name: 'Kyoto', firstDate: '2027-05-01', dayCount: 1 })).body;
    const otherDay = (await agent.get(`/segments/${other.id}`)).body.days[0];
    const a = (await addToPool(stay.id, 10)).body;

    const wrong = await agent.patch(`/stages/${a.id}`).send({ dayId: otherDay.id });
    expect(wrong.status).toBe(400);

    const { body: loose } = await agent.post(`/trips/${trip.id}/days`).send({
      date: '2027-06-01',
      start: { lat: 10, lng: 0 },
      end: { lat: 10, lng: 0 },
      startTime: 540,
      travelMode: 'walking',
    });
    const place = await makePlace(5);
    const standalone = (
      await agent.post(`/days/${loose.id}/stages`).send({ placeId: place.id, category: 'park' })
    ).body;
    const moved = await agent.patch(`/stages/${standalone.id}`).send({ dayId: otherDay.id });
    expect(moved.status).toBe(400);
    expect(moved.body.error.code).toBe('not_in_stay');

    // A full day (15 places) cannot take another one.
    const full = (await agent.get(`/segments/${stay.id}`)).body.days[0];
    for (let i = 0; i < 15; i++) {
      const p = await makePlace(i);
      await agent.post(`/days/${full.id}/stages`).send({ placeId: p.id, category: 'park' });
    }
    const overflow = await agent.patch(`/stages/${a.id}`).send({ dayId: full.id });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error.code).toBe('day_full');
  });

  it('a place added straight to a day of a stay belongs to that stay', async () => {
    const { agent, createStay, makePlace } = await setup();
    const stay = (await createStay()).body;
    const day = (await agent.get(`/segments/${stay.id}`)).body.days[0];
    const place = await makePlace(10);

    const res = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place.id, category: 'park' });

    expect(res.body).toMatchObject({ dayId: day.id, segmentId: stay.id });
  });
});

describe('booking a time (pin)', () => {
  async function onDay() {
    const s = await setup();
    const stay = (await s.createStay()).body;
    const day = (await s.agent.get(`/segments/${stay.id}`)).body.days[0];
    const a = (await s.addToPool(stay.id, 10)).body;
    await s.agent.patch(`/stages/${a.id}`).send({ dayId: day.id });
    return { ...s, stay, day, a };
  }

  it('can be set on a day and removed', async () => {
    const { agent, a } = await onDay();

    const pinned = await agent.patch(`/stages/${a.id}`).send({ pinnedTime: 1140 });
    expect(pinned.body.pinnedTime).toBe(1140);
    const removed = await agent.patch(`/stages/${a.id}`).send({ pinnedTime: null });
    expect(removed.body.pinnedTime).toBeNull();
  });

  it('needs a day (not the pool) and a time inside the day', async () => {
    const { agent, stay, day, addToPool, a } = await onDay();
    const pooled = (await addToPool(stay.id, 20)).body;

    expect((await agent.patch(`/stages/${pooled.id}`).send({ pinnedTime: 700 })).status).toBe(400);
    expect((await agent.patch(`/stages/${a.id}`).send({ pinnedTime: 100 })).status).toBe(400); // before 9:00
    await agent.patch(`/days/${day.id}`).send({ endTime: 1200 }).expect(200);
    expect((await agent.patch(`/stages/${a.id}`).send({ pinnedTime: 1300 })).status).toBe(400); // after the end
  });

  it('is cleared when the place moves to another day', async () => {
    const { agent, stay, a } = await onDay();
    await agent.patch(`/stages/${a.id}`).send({ pinnedTime: 1140 });
    const second = (await agent.get(`/segments/${stay.id}`)).body.days[1];

    const moved = await agent.patch(`/stages/${a.id}`).send({ dayId: second.id });

    expect(moved.body).toMatchObject({ dayId: second.id, pinnedTime: null });
  });

  it('gives the day solve a narrow window at the booked time (a must, whatever the opening hours)', async () => {
    const { agent, day, a } = await onDay();
    await agent.patch(`/stages/${a.id}`).send({ pinnedTime: 1140, priority: 'optional' });

    const res = await agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });

    expect(res.status).toBe(200);
    expect(res.body.visits[0]).toMatchObject({ stageId: a.id, serviceStart: 1140 });
    // park = 20 minutes, plus the slack.
    expect(res.body.visits[0].window).toEqual({ open: 1140, close: 1140 + 20 + 15 });
    expect(res.body.dropped).toEqual([]);
  });
});

describe('the database', () => {
  it('keeps old days and stages working: a standalone day has no segment', async () => {
    const { agent, trip, makePlace } = await setup();
    const { body: day } = await agent.post(`/trips/${trip.id}/days`).send({
      date: '2027-06-01',
      start: { lat: 10, lng: 0 },
      end: { lat: 10, lng: 0 },
      startTime: 540,
      travelMode: 'walking',
    });
    const place = await makePlace(10);
    const stage = (
      await agent.post(`/days/${day.id}/stages`).send({ placeId: place.id, category: 'park' })
    ).body;

    expect(day.segmentId).toBeNull();
    expect(stage).toMatchObject({ segmentId: null, pinnedTime: null, dayId: day.id });
  });
});
