import { describe, expect, it, vi } from 'vitest';
import { QuotaExceededError, createUsageGuard } from './guard.js';
import { GoogleRejectedError } from './errors.js';
import { createHttpMapsClient } from './http-client.js';
import { withUsageGuard } from './guarded.js';
import { fakeMaps } from '../test-maps.js';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

const a = { lat: 35.68, lng: 139.76 };
const b = { lat: 35.71, lng: 139.8 };
const c = { lat: 35.69, lng: 139.7 };

describe('computeRoute over HTTP', () => {
  it('asks for only the polyline, with the stops in between, and returns it', async () => {
    const fetch = fakeFetch(200, { routes: [{ polyline: { encodedPolyline: '_p~iF~ps|U' } }] });
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const line = await client.computeRoute({
      origin: a,
      destination: c,
      intermediates: [b],
      mode: 'walking',
    });

    expect(line).toBe('_p~iF~ps|U');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
      'routes.polyline.encodedPolyline',
    );
    const body = JSON.parse(String(init?.body));
    expect(body.travelMode).toBe('WALK');
    expect(body.origin.location.latLng).toEqual({ latitude: 35.68, longitude: 139.76 });
    expect(body.destination.location.latLng).toEqual({ latitude: 35.69, longitude: 139.7 });
    expect(body.intermediates).toHaveLength(1);
    expect(body.routingPreference).toBeUndefined();
  });

  it('uses the traffic-unaware tier for driving', async () => {
    const fetch = fakeFetch(200, { routes: [{ polyline: { encodedPolyline: 'x' } }] });
    const client = createHttpMapsClient({ apiKey: 'K', fetch });

    await client.computeRoute({ origin: a, destination: b, intermediates: [], mode: 'driving' });

    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
  });

  it('reports an answer without a route as a rejected request', async () => {
    const client = createHttpMapsClient({ apiKey: 'K', fetch: fakeFetch(200, {}) });

    await expect(
      client.computeRoute({ origin: a, destination: b, intermediates: [], mode: 'walking' }),
    ).rejects.toThrow(GoogleRejectedError);
  });

  it('refuses more than 25 stops in between without calling Google', async () => {
    const fetch = fakeFetch(200, {});
    const client = createHttpMapsClient({ apiKey: 'K', fetch });

    await expect(
      client.computeRoute({
        origin: a,
        destination: b,
        intermediates: Array.from({ length: 26 }, () => c),
        mode: 'walking',
      }),
    ).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('computeRoute through the usage guard', () => {
  it('bills one call per route line, and never sends one past the cap', async () => {
    const { db, pool } = createDb(testDatabaseUrl);
    try {
      await resetDb(db);
      const guard = createUsageGuard({
        db,
        caps: {
          autocomplete: 100,
          placeDetails: 100,
          routeMatrix: 100,
          computeRoutes: 1,
          transitMatrix: 1,
          transitRoutes: 1,
        },
      });
      const maps = fakeMaps({ computeRoute: async () => 'line' });
      const guarded = withUsageGuard(maps, guard);
      const input = { origin: a, destination: b, intermediates: [], mode: 'walking' as const };

      await guarded.computeRoute(input);
      await expect(guarded.computeRoute(input)).rejects.toThrow(QuotaExceededError);

      expect(maps.computeRoute).toHaveBeenCalledTimes(1);
    } finally {
      await pool.end();
    }
  });
});
