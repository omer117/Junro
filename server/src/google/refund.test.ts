import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { fakeMaps } from '../test-maps.js';
import { GooglePlaceNotFoundError, GoogleRejectedError, GoogleUnavailableError } from './errors.js';
import { createUsageGuard, type QuotaCaps } from './guard.js';
import { withUsageGuard } from './guarded.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const caps = (over: Partial<QuotaCaps> = {}): QuotaCaps => ({
  autocomplete: 100,
  placeDetails: 100,
  routeMatrix: 100,
  computeRoutes: 100,
  ...over,
});
const point = { lat: 1, lng: 1 };
const matrixInput = {
  origins: [point, point, point],
  destinations: [point, point, point],
  mode: 'walking' as const,
};

describe('guard.refund', () => {
  it('gives units back', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    await guard.consume('routeMatrix', 9);

    await guard.refund('routeMatrix', 4);

    expect((await guard.usage()).routeMatrix).toBe(5);
  });

  it('never goes below zero, and does nothing when nothing was used', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    await guard.refund('placeDetails', 3);
    await guard.consume('routeMatrix', 2);

    await guard.refund('routeMatrix', 50);

    const usage = await guard.usage();
    expect(usage.placeDetails).toBe(0);
    expect(usage.routeMatrix).toBe(0);
  });
});

describe('calls that Google rejected are not billed, so they are not counted', () => {
  it('refunds a rejected route matrix (all 9 elements)', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    const maps = fakeMaps({
      routeMatrix: async () => {
        throw new GoogleRejectedError(403);
      },
    });

    await expect(withUsageGuard(maps, guard).routeMatrix(matrixInput)).rejects.toThrow(
      GoogleRejectedError,
    );

    expect((await guard.usage()).routeMatrix).toBe(0);
  });

  it('refunds a place that Google does not know', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    const maps = fakeMaps({
      placeDetails: async () => {
        throw new GooglePlaceNotFoundError();
      },
    });

    await expect(withUsageGuard(maps, guard).placeDetails({ googlePlaceId: 'x' })).rejects.toThrow(
      GooglePlaceNotFoundError,
    );

    expect((await guard.usage()).placeDetails).toBe(0);
  });

  it('keeps retries possible: ten rejected attempts do not use up a cap of 5', async () => {
    const guard = createUsageGuard({ db, caps: caps({ computeRoutes: 5 }) });
    const maps = fakeMaps({
      computeRoute: async () => {
        throw new GoogleRejectedError(403);
      },
    });
    const guarded = withUsageGuard(maps, guard);

    for (let i = 0; i < 10; i++) {
      await guarded
        .computeRoute({ origin: point, destination: point, intermediates: [], mode: 'walking' })
        .catch(() => undefined);
    }

    expect(maps.computeRoute).toHaveBeenCalledTimes(10);
    expect((await guard.usage()).computeRoutes).toBe(0);
  });
});

describe('calls that may have been billed stay counted', () => {
  it('counts a successful call', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    const maps = fakeMaps({ routeMatrix: async () => [[0]] });

    await withUsageGuard(maps, guard).routeMatrix(matrixInput);

    expect((await guard.usage()).routeMatrix).toBe(9);
  });

  it('counts a call that timed out or hit a Google server error (it may have been billed)', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    const maps = fakeMaps({
      routeMatrix: async () => {
        throw new GoogleUnavailableError();
      },
    });

    await expect(withUsageGuard(maps, guard).routeMatrix(matrixInput)).rejects.toThrow(
      GoogleUnavailableError,
    );

    expect((await guard.usage()).routeMatrix).toBe(9);
  });

  it('counts a call that failed for an unknown reason', async () => {
    const guard = createUsageGuard({ db, caps: caps() });
    const maps = fakeMaps({
      routeMatrix: async () => {
        throw new Error('something unexpected');
      },
    });

    await expect(withUsageGuard(maps, guard).routeMatrix(matrixInput)).rejects.toThrow(
      'something unexpected',
    );

    expect((await guard.usage()).routeMatrix).toBe(9);
  });
});
