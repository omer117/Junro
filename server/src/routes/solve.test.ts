import type { LatLng } from '@junro/solver';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { places, stages } from '../db/schema.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { GoogleUnavailableError } from '../google/errors.js';
import type { OpeningHours } from '../google/types.js';
import { createTestApp, signInAs } from '../test-app.js';
import { fakeMaps } from '../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

/** Everything is on a line: longitude is the distance, one unit = 1 minute of travel. */
const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng) * 60));

const goodMaps = () =>
  fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    computeRoute: async ({ intermediates }) => `line-through-${intermediates.length}`,
  });

const matrixElements = (maps: ReturnType<typeof fakeMaps>) =>
  maps.routeMatrix.mock.calls.reduce(
    (sum, [r]) => sum + r.origins.length * r.destinations.length,
    0,
  );

// 2027-04-01 is a Thursday (Google weekday 4).
const dayBody = {
  date: '2027-04-01',
  start: { lat: 10, lng: 0 },
  end: { lat: 10, lng: 0 },
  startTime: 540,
  travelMode: 'walking',
};

let placeCounter = 0;
async function newPlace(x: number, openingHours?: OpeningHours) {
  placeCounter += 1;
  const [place] = await db
    .insert(places)
    .values({
      googlePlaceId: `ChIJ-place-${placeCounter}-x${x}`,
      name: `Place ${x}`,
      lat: 10,
      lng: x,
      openingHours: openingHours ?? null,
    })
    .returning();
  return place!;
}

async function setup(maps = goodMaps(), overrides: Parameters<typeof createTestApp>[1] = {}) {
  const app = createTestApp(db, { maps, ...overrides });
  const { agent, user } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'Japan' });
  const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(dayBody);

  const addStage = async (
    x: number,
    extra: { category?: string; stayOverrideMinutes?: number; openingHours?: OpeningHours } = {},
  ) => {
    const place = await newPlace(x, extra.openingHours);
    const { body } = await agent.post(`/days/${day.id}/stages`).send({
      placeId: place.id,
      category: extra.category ?? 'park',
      ...(extra.stayOverrideMinutes ? { stayOverrideMinutes: extra.stayOverrideMinutes } : {}),
    });
    return body as { id: string };
  };
  const solve = (mode: 'full' | 'minimal' = 'full') =>
    agent.post(`/days/${day.id}/solve`).send({ mode });

  return { app, agent, user, maps, day, addStage, solve };
}

const idsAt = async (agent: request.Agent, dayId: string) =>
  (await agent.get(`/days/${dayId}/stages`)).body as Array<{
    id: string;
    place: { name: string };
    position: number | null;
  }>;

describe('POST /days/:id/solve', () => {
  it('requires sign-in, and an anonymous request never reaches Google', async () => {
    const { app, maps, day } = await setup();

    await request(app).post(`/days/${day.id}/solve`).send({ mode: 'full' }).expect(401);

    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's day, and never reaches Google", async () => {
    const { app, maps, day } = await setup();
    const bob = await signInAs(db, app, 'Bob');

    await bob.agent.post(`/days/${day.id}/solve`).send({ mode: 'full' }).expect(404);

    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });

  it.each([{}, { mode: 'fast' }, { mode: 5 }])('refuses the body %j', async (body) => {
    const { agent, day } = await setup();

    await agent.post(`/days/${day.id}/solve`).send(body).expect(400);
  });

  describe('full recalculation', () => {
    it('orders the stages, times them, and draws the line', async () => {
      const { addStage, solve, agent, day } = await setup();
      const far = await addStage(30);
      const near = await addStage(10);
      const mid = await addStage(20);

      const res = await solve('full');

      // Park stays 20 min. Start 540: near 550-570, mid 580-600, far 610-630, home at 660.
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('full');
      expect(res.body.order).toEqual([near.id, mid.id, far.id]);
      expect(res.body.visits[0]).toEqual({
        stageId: near.id,
        arrival: 550,
        serviceStart: 550,
        departure: 570,
        waited: 0,
      });
      expect(res.body.endArrival).toBe(660);
      expect(res.body.violations).toEqual([]);
      expect(res.body.totalLateness).toBe(0);
      expect(res.body.routeLine).toBe('line-through-3');

      // The order is saved on the stages.
      const saved = await idsAt(agent, day.id);
      expect(saved.map((s) => [s.id, s.position]).sort()).toEqual(
        [
          [near.id, 0],
          [mid.id, 1],
          [far.id, 2],
        ].sort(),
      );
    });

    it('uses a stage override over the category default', async () => {
      const { addStage, solve } = await setup();
      await addStage(10);
      await addStage(20, { stayOverrideMinutes: 5 });
      await addStage(30);

      const res = await solve('full');

      // The middle stage stays 5 instead of 20: home 15 minutes earlier.
      expect(res.body.endArrival).toBe(645);
    });

    it("uses the user's stay preference for the category", async () => {
      const { agent, addStage, solve } = await setup();
      await agent.put('/me/stay-durations/park').send({ stayMinutes: 60 }).expect(200);
      await addStage(10);

      const res = await solve('full');

      // 540 + 10 travel + 60 stay + 10 back.
      expect(res.body.endArrival).toBe(620);
    });

    it('waits for a place to open', async () => {
      const { addStage, solve } = await setup();
      const thursday1pmTo6pm: OpeningHours = {
        periods: [
          { open: { day: 4, hour: 13, minute: 0 }, close: { day: 4, hour: 18, minute: 0 } },
        ],
      };
      const late = await addStage(10, { openingHours: thursday1pmTo6pm });

      const res = await solve('full');

      // Arrives 550, opens at 780 (13:00), stays 20, leaves 800, home at 810.
      expect(res.body.visits[0]).toMatchObject({
        stageId: late.id,
        arrival: 550,
        serviceStart: 780,
        departure: 800,
        waited: 230,
      });
      expect(res.body.endArrival).toBe(810);
    });

    it('flags a stage that cannot fit instead of dropping it', async () => {
      const { addStage, solve } = await setup();
      const closesAt9h20: OpeningHours = {
        periods: [{ open: { day: 4, hour: 6, minute: 0 }, close: { day: 4, hour: 9, minute: 20 } }],
      };
      const tight = await addStage(10, { openingHours: closesAt9h20 });

      const res = await solve('full');

      // Leaves at 570 but it closes at 560: 10 minutes late.
      expect(res.body.order).toEqual([tight.id]);
      expect(res.body.violations).toEqual([{ stageId: tight.id, kind: 'closed', minutesLate: 10 }]);
      expect(res.body.totalLateness).toBe(10);
    });

    it('flags a place that is closed on that weekday', async () => {
      const { addStage, solve } = await setup();
      const onlyFridays: OpeningHours = {
        periods: [{ open: { day: 5, hour: 9, minute: 0 }, close: { day: 5, hour: 17, minute: 0 } }],
      };
      const shut = await addStage(10, { openingHours: onlyFridays });

      const res = await solve('full');

      expect(res.body.violations).toEqual([{ stageId: shut.id, kind: 'closed_all_day' }]);
      expect(res.body.order).toEqual([shut.id]);
    });

    it('solves a day with no stages: straight from start to end', async () => {
      const { solve } = await setup();

      const res = await solve('full');

      expect(res.status).toBe(200);
      expect(res.body.order).toEqual([]);
      expect(res.body.endArrival).toBe(540);
      expect(res.body.routeLine).toBeNull();
    });

    it('costs Google nothing the second time when nothing changed', async () => {
      const { maps, addStage, solve } = await setup();
      await addStage(10);
      await addStage(20);
      await solve('full').expect(200);
      const matrixCalls = maps.routeMatrix.mock.calls.length;
      const routeCalls = maps.computeRoute.mock.calls.length;

      const again = await solve('full');

      expect(again.status).toBe(200);
      expect(maps.routeMatrix.mock.calls.length).toBe(matrixCalls);
      expect(maps.computeRoute.mock.calls.length).toBe(routeCalls);
    });
  });

  describe('minimal change', () => {
    it('with no route yet, does a full solve and says so', async () => {
      const { addStage, solve } = await setup();
      await addStage(10);

      const res = await solve('minimal');

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('full');
    });

    it('slots a new stage in without reordering, and asks Google only for the new row and column', async () => {
      const { maps, addStage, solve } = await setup();
      const a = await addStage(30);
      const b = await addStage(10);
      const c = await addStage(20);
      await solve('full').expect(200); // order: b, c, a
      const before = matrixElements(maps);

      const d = await addStage(25);
      const res = await solve('minimal');

      expect(res.body.mode).toBe('minimal');
      expect(res.body.order).toEqual([b.id, c.id, d.id, a.id]);
      // 4 points before (home + 3 stages), 5 now: 5 for the new row + 4 for the new column.
      expect(matrixElements(maps) - before).toBe(9);
    });

    it('keeps the order the user already has, even if a full solve would change it', async () => {
      const { addStage, solve } = await setup();
      const a = await addStage(30);
      const b = await addStage(10);
      await solve('full').expect(200); // b, a
      // The user's route is now b, a. Flip the saved order by hand to a, b ("their" route).
      await db.update(stages).set({ position: 0 }).where(eq(stages.id, a.id));
      await db.update(stages).set({ position: 1 }).where(eq(stages.id, b.id));
      const c = await addStage(20);

      const res = await solve('minimal');

      expect(res.body.order.filter((id: string) => id !== c.id)).toEqual([a.id, b.id]);
    });

    it('skips a removed stage without asking Google for travel times', async () => {
      const { agent, maps, addStage, solve } = await setup();
      await addStage(10);
      const b = await addStage(20);
      await addStage(30);
      const first = await solve('full').expect(200);
      const matrixCalls = maps.routeMatrix.mock.calls.length;
      await agent.delete(`/stages/${b.id}`).expect(204);

      const res = await solve('minimal');

      // The same order as before, with b simply missing (a round trip can be walked either
      // way round at equal cost, so the test takes the order from the first solve).
      expect(res.body.order).toEqual(first.body.order.filter((id: string) => id !== b.id));
      expect(maps.routeMatrix.mock.calls.length).toBe(matrixCalls);
      expect(res.body.routeLine).toBe('line-through-2');
    });
  });

  describe('when Google or the quota gets in the way', () => {
    it('saves nothing and says so when Google is down', async () => {
      const maps = fakeMaps({
        routeMatrix: async () => {
          throw new GoogleUnavailableError();
        },
      });
      const { agent, addStage, solve, day } = await setup(maps);
      await addStage(10);

      const res = await solve('full');

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('google_unavailable');
      expect((await idsAt(agent, day.id))[0]!.position).toBeNull();
    });

    it('stops with a clear message when the monthly matrix budget is used up, and saves nothing', async () => {
      const maps = goodMaps();
      const { agent, addStage, solve, day } = await setup(maps, {
        quotaCaps: { autocomplete: 10, placeDetails: 10, routeMatrix: 3, computeRoutes: 10 },
      });
      await addStage(10);
      await addStage(20);

      const res = await solve('full');

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('quota_reached');
      expect(maps.routeMatrix).not.toHaveBeenCalled();
      expect((await idsAt(agent, day.id))[0]!.position).toBeNull();
    });

    it('still returns the order, without a line, when only the line fails', async () => {
      const maps = fakeMaps({
        routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
        computeRoute: async () => {
          throw new GoogleUnavailableError();
        },
      });
      const { agent, addStage, solve, day } = await setup(maps);
      const a = await addStage(10);

      const res = await solve('full');

      expect(res.status).toBe(200);
      expect(res.body.order).toEqual([a.id]);
      expect(res.body.routeLine).toBeNull();
      expect(res.body.routeLineError).toBe('google_unavailable');
      expect((await idsAt(agent, day.id))[0]!.position).toBe(0);
    });

    it('says 422 when no order of the stages can be travelled', async () => {
      const maps = fakeMaps({
        routeMatrix: async ({ origins, destinations }) =>
          origins.map(() => destinations.map(() => Infinity)),
      });
      const { addStage, solve } = await setup(maps);
      await addStage(10);

      const res = await solve('full');

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unreachable');
    });

    it('answers 503 when Google is not configured', async () => {
      const app = createTestApp(db);
      const { agent } = await signInAs(db, app);
      const { body: trip } = await agent.post('/trips').send({ name: 'T' });
      const { body: day } = await agent.post(`/trips/${trip.id}/days`).send(dayBody);

      const res = await agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('google_not_configured');
    });

    it('limits how often one user can solve', async () => {
      const { addStage, solve } = await setup(goodMaps(), { solveRateLimit: 2 });
      await addStage(10);

      const statuses = [(await solve()).status, (await solve()).status, (await solve()).status];

      expect(statuses).toEqual([200, 200, 429]);
    });
  });
});

describe('POST /days/:id/solve in the middle of the day', () => {
  /** Three stops (A at 1, B at 2, C at 4); A is already done and sits first in the saved order. */
  async function midDay() {
    const s = await setup();
    const a = await s.addStage(1);
    const b = await s.addStage(2);
    const c = await s.addStage(4);
    await s.agent.patch(`/stages/${a.id}`).send({ done: true }).expect(200);
    await s.solve('full');
    s.maps.routeMatrix.mockClear();
    const here = { lat: 10, lng: 2 };
    const solveFromHere = (now = 600) =>
      s.agent.post(`/days/${s.day.id}/solve`).send({ mode: 'full', from: here, now });
    return { ...s, a, b, c, here, solveFromHere };
  }

  it('leaves done stages out and starts from where you are, at the time it is now', async () => {
    const { b, c, solveFromHere } = await midDay();

    const res = await solveFromHere(600);

    expect(res.status).toBe(200);
    expect([...res.body.order].sort()).toEqual([b.id, c.id].sort());
    // From lng 2 at 10:00 (one unit is one minute, a park takes 20): both orders end at 10:46.
    expect(res.body.visits[0].arrival).toBeGreaterThanOrEqual(600);
    expect(res.body.endArrival).toBe(646);
  });

  it('keeps the end point and the day itself as they were', async () => {
    const { agent, day, solveFromHere } = await midDay();

    await solveFromHere();

    const saved = (await agent.get(`/trips/${day.tripId}/days`)).body[0];
    expect(saved).toMatchObject({ startTime: 540 });
    expect(saved.startName ?? null).toBeNull();
  });

  it('puts done stages first in the saved order, then the new order', async () => {
    const { agent, day, a, solveFromHere } = await midDay();

    const res = await solveFromHere();

    const saved = (await idsAt(agent, day.id)).sort((x, y) => x.position! - y.position!);
    expect(saved.map((s) => s.id)).toEqual([a.id, ...res.body.order]);
  });

  it('refuses a location without a time (and a time without a location) before asking Google', async () => {
    const { agent, day, maps, here } = await midDay();

    await agent.post(`/days/${day.id}/solve`).send({ mode: 'full', from: here }).expect(400);
    await agent.post(`/days/${day.id}/solve`).send({ mode: 'full', now: 600 }).expect(400);

    expect(maps.routeMatrix).not.toHaveBeenCalled();
  });

  it('with every stop done, just heads for the end point', async () => {
    const { agent, b, c, solveFromHere } = await midDay();
    await agent.patch(`/stages/${b.id}`).send({ done: true });
    await agent.patch(`/stages/${c.id}`).send({ done: true });

    const res = await solveFromHere(600);

    expect(res.status).toBe(200);
    expect(res.body.order).toEqual([]);
    expect(res.body.endArrival).toBe(602);
  });
});
