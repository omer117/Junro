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

/** On a line: longitude is the distance, one unit is one minute. */
const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng) * 60));

const dayBody = {
  date: '2027-04-01',
  start: { lat: 10, lng: 0 },
  end: { lat: 10, lng: 0 },
  startTime: 540, // 9:00
  travelMode: 'walking',
};

let counter = 0;
async function setup(dayExtra: Record<string, unknown> = {}) {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    computeRoute: async ({ intermediates }) => `line-${intermediates.length}`,
  });
  const app = createTestApp(db, { maps });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const { body: day } = await agent
    .post(`/trips/${trip.id}/days`)
    .send({ ...dayBody, ...dayExtra });

  const addStage = async (x: number, priority?: 'must' | 'optional') => {
    counter += 1;
    const [place] = await db
      .insert(places)
      .values({ googlePlaceId: `ChIJ-priority-${counter}`, name: `Place ${x}`, lat: 10, lng: x })
      .returning();
    const { body } = await agent.post(`/days/${day.id}/stages`).send({
      placeId: place!.id,
      category: 'park', // a stay of 20 minutes
      ...(priority ? { priority } : {}),
    });
    return body as { id: string };
  };
  const solve = (mode: 'full' | 'minimal' = 'full') =>
    agent.post(`/days/${day.id}/solve`).send({ mode });
  const stages = async () =>
    (await agent.get(`/days/${day.id}/stages`)).body as Array<{
      id: string;
      priority: string;
      dropped: boolean;
      position: number | null;
    }>;
  return { app, agent, maps, day, addStage, solve, stages };
}

describe('priority of a stop', () => {
  it('is "must" by default, and a stop starts out not dropped', async () => {
    const { addStage, stages } = await setup();
    await addStage(10);

    expect((await stages())[0]).toMatchObject({ priority: 'must', dropped: false });
  });

  it('can be chosen when the stop is added, and changed later', async () => {
    const { agent, addStage, stages } = await setup();
    const a = await addStage(10, 'optional');

    expect((await stages())[0]!.priority).toBe('optional');
    await agent.patch(`/stages/${a.id}`).send({ priority: 'must' }).expect(200);
    expect((await stages())[0]!.priority).toBe('must');
  });

  it('refuses anything but must or optional', async () => {
    const { agent, addStage } = await setup();
    const a = await addStage(10);

    await agent.patch(`/stages/${a.id}`).send({ priority: 'urgent' }).expect(400);
  });

  it('cannot be changed by someone else (their stop is a 404)', async () => {
    const { app, addStage } = await setup();
    const a = await addStage(10);
    const bob = await signInAs(db, app, 'Bob');

    await bob.agent.patch(`/stages/${a.id}`).send({ priority: 'optional' }).expect(404);
  });
});

describe('the day end time', () => {
  it('is empty by default, and kept when given', async () => {
    const plain = await setup();
    expect(plain.day.endTime).toBeNull();

    const limited = await setup({ endTime: 1320 });
    expect(limited.day.endTime).toBe(1320);
  });

  it('must be after the start time', async () => {
    const { agent, day } = await setup();
    const { body: trip } = await agent.post('/trips').send({ name: 'T' });

    await agent
      .post(`/trips/${trip.id}/days`)
      .send({ ...dayBody, endTime: 540 })
      .expect(400);
    await agent
      .post(`/trips/${trip.id}/days`)
      .send({ ...dayBody, endTime: 500 })
      .expect(400);
    await agent.patch(`/days/${day.id}`).send({ endTime: 300 }).expect(400);
  });

  it('can be set and cleared on a day, and the start cannot move past it', async () => {
    const { agent, day } = await setup();

    const set = await agent.patch(`/days/${day.id}`).send({ endTime: 1200 });
    expect(set.body.endTime).toBe(1200);
    await agent.patch(`/days/${day.id}`).send({ startTime: 1300 }).expect(400);
    const cleared = await agent.patch(`/days/${day.id}`).send({ endTime: null });
    expect(cleared.body.endTime).toBeNull();
  });
});

describe('solving a day with optional stops', () => {
  // Start 9:00, day ends at 12:00. A (must) is 10 away. B (optional) is 100 away: keeping it
  // means back at 13:00, an hour after the end of the day.
  async function overFullDay() {
    const s = await setup({ endTime: 720 });
    const a = await s.addStage(10, 'must');
    const b = await s.addStage(100, 'optional');
    return { ...s, a, b };
  }

  it('leaves out the optional stop that does not fit, says so, and never drops a must', async () => {
    const { a, b, solve } = await overFullDay();

    const res = await solve();

    expect(res.status).toBe(200);
    expect(res.body.order).toEqual([a.id]);
    expect(res.body.dropped).toEqual([b.id]);
    expect(res.body.totalLateness).toBe(0);
  });

  it('remembers it: the stop is marked dropped and has no place in the route', async () => {
    const { b, solve, stages } = await overFullDay();

    await solve();

    const saved = (await stages()).find((s) => s.id === b.id)!;
    expect(saved).toMatchObject({ dropped: true, position: null });
  });

  it('shows the same route again after a reload, with the dropped stop, without calling Google', async () => {
    const { agent, maps, day, a, b, solve } = await overFullDay();
    const solved = await solve();
    maps.routeMatrix.mockClear();
    maps.computeRoute.mockClear();

    const saved = await agent.get(`/days/${day.id}/route`);

    expect(saved.status).toBe(200);
    expect(saved.body.order).toEqual([a.id]);
    expect(saved.body.dropped).toEqual([b.id]);
    expect(saved.body.endArrival).toBe(solved.body.endArrival);
    expect(maps.routeMatrix).not.toHaveBeenCalled();
    expect(maps.computeRoute).not.toHaveBeenCalled();
  });

  it('puts a dropped stop back when it is made a must and the day is calculated again', async () => {
    const { agent, a, b, solve, stages } = await overFullDay();
    await solve();

    await agent.patch(`/stages/${b.id}`).send({ priority: 'must' }).expect(200);
    const res = await solve();

    expect([...res.body.order].sort()).toEqual([a.id, b.id].sort());
    expect(res.body.dropped).toEqual([]);
    // A must is never dropped: the day is simply too long, and it is flagged.
    expect(res.body.violations).toContainEqual({ kind: 'past_day_end', minutesLate: 60 });
    expect((await stages()).every((s) => !s.dropped)).toBe(true);
  });

  it('thinks again about a dropped stop on a full recalculation, for example when the day gets longer', async () => {
    const { agent, day, a, b, solve } = await overFullDay();
    await solve();

    await agent.patch(`/days/${day.id}`).send({ endTime: 900 }).expect(200);
    const res = await solve('full');

    expect([...res.body.order].sort()).toEqual([a.id, b.id].sort());
    expect(res.body.dropped).toEqual([]);
  });

  it('keeps a dropped stop dropped when only a new stop is fitted in (keep my order)', async () => {
    const { a, b, addStage, solve, stages } = await overFullDay();
    await solve();
    const c = await addStage(5, 'must');

    const res = await solve('minimal');

    expect(res.body.mode).toBe('minimal');
    expect([...res.body.order].sort()).toEqual([a.id, c.id].sort());
    expect(res.body.dropped).toEqual([b.id]);
    expect((await stages()).find((s) => s.id === b.id)!.dropped).toBe(true);
  });

  it('needs a new calculation after a stop is added, as before', async () => {
    const { agent, day, addStage, solve } = await overFullDay();
    await solve();
    await addStage(5, 'must');

    await agent.get(`/days/${day.id}/route`).expect(204);
  });

  it('flags a day that is too long even for its musts, and drops the optional ones', async () => {
    const s = await setup({ endTime: 560 });
    const a = await s.addStage(100, 'must');
    const b = await s.addStage(5, 'optional');

    const res = await s.solve();

    expect(res.body.order).toEqual([a.id]);
    expect(res.body.dropped).toEqual([b.id]);
    expect(res.body.violations.some((v: { kind: string }) => v.kind === 'past_day_end')).toBe(true);
  });

  it('with no priorities and no end time, nothing is ever dropped', async () => {
    const s = await setup();
    await s.addStage(10);
    await s.addStage(100);

    const res = await s.solve();

    expect(res.body.order).toHaveLength(2);
    expect(res.body.dropped).toEqual([]);
  });
});
