import type { LatLng } from '@junro/solver';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../db/client.js';
import { places } from '../../db/schema.js';
import { resetDb, testDatabaseUrl } from '../../db/test-db.js';
import { createTestApp, signInAs } from '../../test-app.js';
import { fakeMaps } from '../../test-maps.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const lineMatrix = (origins: LatLng[], destinations: LatLng[]) =>
  origins.map((o) => destinations.map((d) => Math.abs(o.lng - d.lng)));

// 2027-04-01 is a Thursday (Google weekday 4). Lunch 11:30-14:30, dinner 17:30-22:00.
const lunchHours = {
  periods: [
    { open: { day: 4, hour: 11, minute: 30 }, close: { day: 4, hour: 14, minute: 30 } },
    { open: { day: 4, hour: 17, minute: 30 }, close: { day: 4, hour: 22, minute: 0 } },
  ],
};

let counter = 0;
async function setup(startTime: number) {
  const maps = fakeMaps({
    routeMatrix: async ({ origins, destinations }) => lineMatrix(origins, destinations),
    computeRoute: async () => 'LINE',
  });
  const app = createTestApp(db, { maps });
  const { agent } = await signInAs(db, app);
  const { body: trip } = await agent.post('/trips').send({ name: 'T' });
  const { body: day } = await agent.post(`/trips/${trip.id}/days`).send({
    date: '2027-04-01',
    start: { lat: 10, lng: 0 },
    end: { lat: 10, lng: 0 },
    startTime,
    travelMode: 'walking',
  });
  const addStage = async (x: number, openingHours: unknown, category = 'restaurant') => {
    counter += 1;
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: `ChIJ-open-${counter}`,
        name: `Place ${x}`,
        lat: 10,
        lng: x,
        openingHours: openingHours as never,
      })
      .returning();
    const { body } = await agent
      .post(`/days/${day.id}/stages`)
      .send({ placeId: place!.id, category });
    return body as { id: string };
  };
  const solve = () => agent.post(`/days/${day.id}/solve`).send({ mode: 'full' });
  return { agent, day, addStage, solve };
}

describe('several opening windows on a day', () => {
  it('plans a lunch place for dinner time when the day only reaches it in the break', async () => {
    // Day starts 15:00 (900); the place is 5 minutes away: arrival 15:05, in the break.
    const { addStage, solve } = await setup(900);
    const a = await addStage(5, lunchHours);

    const res = await solve();

    expect(res.status).toBe(200);
    expect(res.body.visits[0].stageId).toBe(a.id);
    expect(res.body.visits[0].serviceStart).toBe(1050); // waits until 17:30
    expect(res.body.visits[0].window).toEqual({ open: 1050, close: 1320 });
    expect(res.body.violations).toEqual([]);
  });

  it('tells the client when each stop is open today, in the solve and in the saved route', async () => {
    const { agent, day, addStage, solve } = await setup(540);
    const lunch = await addStage(5, lunchHours);
    const free = await addStage(9, null, 'park');

    const solved = await solve();
    const saved = await agent.get(`/days/${day.id}/route`);

    const expected = {
      [lunch.id]: [
        { open: 690, close: 870 },
        { open: 1050, close: 1320 },
      ],
      [free.id]: null,
    };
    expect(solved.body.openToday).toEqual(expected);
    expect(saved.body.openToday).toEqual(expected);
    // The raw Google hours never leave the server.
    expect(JSON.stringify(solved.body)).not.toContain('periods');
  });
});
