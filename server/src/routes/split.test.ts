import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { runSplitInWorker } from '../split/run-split.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const stay = {
  name: 'Tokyo',
  firstDate: '2027-04-01',
  dayCount: 2,
  hotel: { lat: 35.68, lng: 139.76 },
  hotelName: 'Hotel',
  travelMode: 'walking',
  startTime: 540,
};

let counter = 0;
async function setup(appOverrides: Record<string, unknown> = {}) {
  const maps = fakeMaps({});
  const app = createTestApp(db, { maps, ...appOverrides });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const segment = (await agent.post(`/trips/${trip.id}/segments`).send(stay)).body;
  const dayIds: string[] = (await agent.get(`/segments/${segment.id}`)).body.days.map(
    (d: { id: string }) => d.id,
  );
  /** A place about `km` kilometres north (+) or south (-) of the hotel. */
  const addPlace = async (km: number, extra: Record<string, unknown> = {}) => {
    counter += 1;
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: `ChIJ-split-${counter}`,
        name: `Place ${counter}`,
        lat: 35.68 + km * 0.009,
        lng: 139.76,
      })
      .returning();
    const res = await agent
      .post(`/segments/${segment.id}/stages`)
      .send({ placeId: place!.id, category: 'museum', ...extra });
    return res.body as { id: string };
  };
  const split = () => agent.post(`/segments/${segment.id}/split`).send({});
  return { app, agent, maps, segment, dayIds, addPlace, split };
}

const proposalToAccept = (body: {
  inputHash: string;
  days: Array<{ dayId: string; order: string[] }>;
}) => ({
  inputHash: body.inputHash,
  days: body.days.map((d) => ({ dayId: d.dayId, stageIds: d.order })),
});

describe('POST /segments/:id/split', () => {
  it('proposes a day for every place, nearby places together, and saves nothing', async () => {
    const { agent, segment, dayIds, addPlace, split } = await setup();
    const north = [await addPlace(4), await addPlace(4.3), await addPlace(4.6)];
    const south = [await addPlace(-4), await addPlace(-4.3), await addPlace(-4.6)];

    const res = await split();

    expect(res.status).toBe(200);
    expect(res.body.estimated).toBe(true);
    expect(res.body.leftOut).toEqual([]);
    const byDay = res.body.days.map((d: { order: string[] }) => [...d.order].sort());
    expect(byDay).toContainEqual([...north.map((s) => s.id)].sort());
    expect(byDay).toContainEqual([...south.map((s) => s.id)].sort());
    expect(res.body.days.map((d: { dayId: string }) => d.dayId)).toEqual(dayIds);
    // Nothing was saved: all six places are still in the pool.
    expect((await agent.get(`/segments/${segment.id}/pool`)).body).toHaveLength(6);
  });

  it('makes no Google call at all', async () => {
    const { maps, addPlace, split } = await setup();
    await addPlace(4);
    await addPlace(-4);

    await split();

    expect(maps.routeMatrix).not.toHaveBeenCalled();
    expect(maps.computeRoute).not.toHaveBeenCalled();
    expect(maps.autocomplete).not.toHaveBeenCalled();
    expect(maps.placeDetails).not.toHaveBeenCalled();
  });

  it('answers 409 when there is nothing to split', async () => {
    const { split } = await setup();

    const res = await split();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('nothing_to_split');
  });

  it("is 404 for someone else's stay", async () => {
    const { app, segment, addPlace } = await setup();
    await addPlace(4);
    const bob = await signInAs(db, app, 'Bob');

    expect((await bob.agent.post(`/segments/${segment.id}/split`).send({})).status).toBe(404);
  });

  it('is limited per user', async () => {
    const { addPlace, split } = await setup({ splitRateLimit: 2 });
    await addPlace(4);

    await split();
    await split();
    const third = await split();

    expect(third.status).toBe(429);
  });

  it('works through a real worker thread too', async () => {
    const { addPlace, split } = await setup({ splitRunner: runSplitInWorker });
    await addPlace(4);
    await addPlace(-4);

    const res = await split();

    expect(res.status).toBe(200);
    expect(res.body.days.flatMap((d: { order: string[] }) => d.order)).toHaveLength(2);
  }, 30_000);

  it('keeps a booked place on its day, at its time', async () => {
    const { agent, dayIds, addPlace, split } = await setup();
    const dinner = await addPlace(4);
    await addPlace(-4);
    await agent.patch(`/stages/${dinner.id}`).send({ dayId: dayIds[1] }).expect(200);
    await agent.patch(`/stages/${dinner.id}`).send({ pinnedTime: 1140 }).expect(200);

    const res = await split();

    const second = res.body.days.find((d: { dayId: string }) => d.dayId === dayIds[1]);
    expect(second.order).toContain(dinner.id);
    expect(
      second.visits.find((v: { stageId: string }) => v.stageId === dinner.id).serviceStart,
    ).toBe(1140);
  });

  it('leaves a day that is already under way (a done place) untouched', async () => {
    const { agent, dayIds, addPlace, split } = await setup();
    const visited = await addPlace(4);
    await addPlace(-4);
    await addPlace(-4.2);
    await agent.patch(`/stages/${visited.id}`).send({ dayId: dayIds[0] }).expect(200);
    await agent.patch(`/stages/${visited.id}`).send({ done: true }).expect(200);

    const res = await split();

    expect(res.body.frozenDayIds).toEqual([dayIds[0]]);
    expect(res.body.days.map((d: { dayId: string }) => d.dayId)).toEqual([dayIds[1]]);
    expect(res.body.days[0].order).toHaveLength(2);
  });
});

describe('POST /segments/:id/split/accept', () => {
  it('puts the places on the proposed days and empties the pool', async () => {
    const { agent, segment, dayIds, addPlace, split } = await setup();
    for (const km of [4, 4.3, -4, -4.3]) await addPlace(km);
    const proposal = (await split()).body;

    const res = await agent
      .post(`/segments/${segment.id}/split/accept`)
      .send(proposalToAccept(proposal));

    expect(res.status).toBe(200);
    expect((await agent.get(`/segments/${segment.id}/pool`)).body).toEqual([]);
    for (const day of proposal.days) {
      const onDay = (await agent.get(`/days/${day.dayId}/stages`)).body.map(
        (s: { id: string }) => s.id,
      );
      expect([...onDay].sort()).toEqual([...day.order].sort());
    }
    expect(dayIds).toHaveLength(2);
  });

  it('makes the next solve of a changed day a full one (positions are cleared)', async () => {
    const { agent, segment, addPlace, split } = await setup();
    await addPlace(4);
    await addPlace(-4);
    const proposal = (await split()).body;

    await agent.post(`/segments/${segment.id}/split/accept`).send(proposalToAccept(proposal));

    for (const day of proposal.days) {
      const stages = (await agent.get(`/days/${day.dayId}/stages`)).body;
      expect(stages.every((s: { position: number | null }) => s.position === null)).toBe(true);
      expect((await agent.get(`/days/${day.dayId}/route`)).status).toBe(204);
    }
  });

  it('refuses a stale proposal (409) when the places changed after it was made', async () => {
    const { agent, segment, addPlace, split } = await setup();
    await addPlace(4);
    const proposal = (await split()).body;
    await addPlace(-4); // changes the state

    const res = await agent
      .post(`/segments/${segment.id}/split/accept`)
      .send(proposalToAccept(proposal));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('stale_proposal');
  });

  it('refuses a plan that moves a booked place off its day, or uses a place of another stay', async () => {
    const { app, agent, segment, dayIds, addPlace, split } = await setup();
    const dinner = await addPlace(4);
    await agent.patch(`/stages/${dinner.id}`).send({ dayId: dayIds[1] });
    await agent.patch(`/stages/${dinner.id}`).send({ pinnedTime: 1140 });
    const proposal = (await split()).body;

    const wrongDay = {
      inputHash: proposal.inputHash,
      days: [
        { dayId: dayIds[0], stageIds: [dinner.id] },
        { dayId: dayIds[1], stageIds: [] },
      ],
    };
    expect((await agent.post(`/segments/${segment.id}/split/accept`).send(wrongDay)).status).toBe(
      400,
    );

    const bob = await signInAs(db, app, 'Bob');
    expect(
      (await bob.agent.post(`/segments/${segment.id}/split/accept`).send(wrongDay)).status,
    ).toBe(404);
  });

  it('moves a place that was left out back to the pool', async () => {
    const { agent, segment, dayIds, addPlace, split } = await setup();
    const a = await addPlace(4);
    const b = await addPlace(-4);
    await agent.patch(`/stages/${a.id}`).send({ dayId: dayIds[0] });
    const proposal = (await split()).body;
    const without = {
      inputHash: proposal.inputHash,
      days: proposal.days.map((d: { dayId: string; order: string[] }) => ({
        dayId: d.dayId,
        stageIds: d.order.filter((id) => id !== b.id && id !== a.id),
      })),
    };

    await agent.post(`/segments/${segment.id}/split/accept`).send(without).expect(200);

    const pool = (await agent.get(`/segments/${segment.id}/pool`)).body.map(
      (s: { id: string }) => s.id,
    );
    expect(pool.sort()).toEqual([a.id, b.id].sort());
  });
});
