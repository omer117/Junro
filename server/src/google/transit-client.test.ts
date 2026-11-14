import { describe, expect, it, vi } from 'vitest';
import { createHttpMapsClient } from './http-client.js';
import { createUsageGuard } from './guard.js';
import { withUsageGuard } from './guarded.js';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { fakeMaps } from '../test-maps.js';
import { DEFAULT_QUOTA_CAPS } from '../config.js';
import { beforeEach, afterAll } from 'vitest';

const fakeFetch = (body: unknown) =>
  vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

const A = { lat: 35.68, lng: 139.76 };
const B = { lat: 35.71, lng: 139.8 };
const departureTime = '2027-04-01T00:00:00.000Z';

describe('transit requests to Google', () => {
  it('asks the matrix for TRANSIT at the given departure time', async () => {
    const fetch = fakeFetch([
      { originIndex: 0, destinationIndex: 0, duration: '900s', condition: 'ROUTE_EXISTS' },
    ]);
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const result = await client.routeMatrix({
      origins: [A],
      destinations: [B],
      mode: 'transit',
      departureTime,
    });

    expect(result).toEqual([[900]]);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ travelMode: 'TRANSIT', departureTime });
    expect(body.routingPreference).toBeUndefined();
  });

  it('refuses a transit matrix of more than 100 elements before it reaches Google', async () => {
    const fetch = fakeFetch([]);
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });
    const points = Array.from({ length: 11 }, (_, i) => ({ lat: 35 + i / 100, lng: 139 }));

    await expect(
      client.routeMatrix({ origins: points, destinations: points, mode: 'transit', departureTime }),
    ).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('draws one transit leg as a line (no stops in between are allowed)', async () => {
    const fetch = fakeFetch({ routes: [{ polyline: { encodedPolyline: 'LINE' } }] });
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const line = await client.computeRoute({
      origin: A,
      destination: B,
      intermediates: [],
      mode: 'transit',
      departureTime,
    });

    expect(line).toBe('LINE');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({
      travelMode: 'TRANSIT',
      departureTime,
    });
    await expect(
      client.computeRoute({
        origin: A,
        destination: B,
        intermediates: [A],
        mode: 'transit',
        departureTime,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('turns the alternatives into plain options: time, walking, changes and the steps', async () => {
    const fetch = fakeFetch({
      routes: [
        {
          duration: '1500s',
          legs: [
            {
              steps: [
                { travelMode: 'WALK', staticDuration: '240s' },
                {
                  travelMode: 'TRANSIT',
                  staticDuration: '1020s',
                  transitDetails: {
                    headsign: 'Asakusa',
                    stopCount: 8,
                    transitLine: {
                      name: 'Ginza Line',
                      nameShort: 'G',
                      vehicle: { type: 'SUBWAY' },
                    },
                  },
                },
                { travelMode: 'WALK', staticDuration: '240s' },
              ],
            },
          ],
        },
        { duration: '1800s', legs: [{ steps: [{ travelMode: 'WALK', staticDuration: '1800s' }] }] },
      ],
    });
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const options = await client.transitAlternatives({ origin: A, destination: B, departureTime });

    expect(options).toEqual([
      {
        minutes: 25,
        walkMinutes: 8,
        transfers: 0,
        steps: [
          { kind: 'walk', minutes: 4 },
          {
            kind: 'transit',
            minutes: 17,
            line: 'Ginza Line',
            vehicle: 'SUBWAY',
            stops: 8,
            headsign: 'Asakusa',
          },
          { kind: 'walk', minutes: 4 },
        ],
      },
      { minutes: 30, walkMinutes: 30, transfers: 0, steps: [{ kind: 'walk', minutes: 30 }] },
    ]);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({
      travelMode: 'TRANSIT',
      departureTime,
      computeAlternativeRoutes: true,
    });
  });
});

describe('the usage guard and transit', () => {
  const { db, pool } = createDb(testDatabaseUrl);
  beforeEach(() => resetDb(db));
  afterAll(() => pool.end());

  it('counts transit matrices and transit routes under their own caps, not the walking ones', async () => {
    const guard = createUsageGuard({ db, caps: DEFAULT_QUOTA_CAPS });
    const maps = fakeMaps({
      routeMatrix: async () => [[0, 0, 0]],
      computeRoute: async () => 'x',
      transitAlternatives: async () => [],
    });
    const guarded = withUsageGuard(maps, guard);

    await guarded.routeMatrix({ origins: [A], destinations: [B, B, B], mode: 'transit' });
    await guarded.routeMatrix({ origins: [A], destinations: [B, B, B], mode: 'walking' });
    await guarded.computeRoute({ origin: A, destination: B, intermediates: [], mode: 'transit' });
    await guarded.transitAlternatives({ origin: A, destination: B, departureTime });

    const used = await guard.usage();
    expect(used.transitMatrix).toBe(3);
    expect(used.routeMatrix).toBe(3);
    expect(used.transitRoutes).toBe(2);
    expect(used.computeRoutes).toBe(0);
  });

  it('stops a transit matrix at its cap', async () => {
    const guard = createUsageGuard({ db, caps: { ...DEFAULT_QUOTA_CAPS, transitMatrix: 2 } });
    const guarded = withUsageGuard(fakeMaps({ routeMatrix: async () => [[0, 0, 0]] }), guard);

    await expect(
      guarded.routeMatrix({ origins: [A], destinations: [B, B, B], mode: 'transit' }),
    ).rejects.toThrow(/transitMatrix/);
  });
});
