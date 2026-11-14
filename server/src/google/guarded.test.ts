import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { fakeMaps } from '../test-maps.js';
import { QuotaExceededError, createUsageGuard } from './guard.js';
import { withUsageGuard } from './guarded.js';

const { db, pool } = createDb(testDatabaseUrl);

beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const point = { lat: 1, lng: 1 };
const caps = (routeMatrix: number) => ({
  autocomplete: 100,
  placeDetails: 100,
  routeMatrix,
  computeRoutes: 100,
  transitMatrix: 100,
  transitRoutes: 100,
});

describe('withUsageGuard', () => {
  it('bills a route matrix per element (origins x destinations)', async () => {
    const guard = createUsageGuard({ db, caps: caps(100) });
    const maps = fakeMaps({ routeMatrix: async () => [[0]] });
    const guarded = withUsageGuard(maps, guard);

    await guarded.routeMatrix({
      origins: [point, point, point],
      destinations: [point, point],
      mode: 'walking',
    });

    expect((await guard.usage()).routeMatrix).toBe(6);
  });

  it('never sends a matrix that would cross the cap', async () => {
    const guard = createUsageGuard({ db, caps: caps(5) });
    const maps = fakeMaps({ routeMatrix: async () => [[0]] });
    const guarded = withUsageGuard(maps, guard);

    await expect(
      guarded.routeMatrix({
        origins: [point, point, point],
        destinations: [point, point],
        mode: 'walking',
      }),
    ).rejects.toThrow(QuotaExceededError);

    expect(maps.routeMatrix).not.toHaveBeenCalled();
    expect((await guard.usage()).routeMatrix).toBe(0);
  });
});
