import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { resetDb, testDatabaseUrl } from '../db/test-db.js';
import { QuotaExceededError, createUsageGuard, usageMonth, type QuotaCaps } from './guard.js';

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

const November = () => new Date('2027-11-15T12:00:00Z');

describe('usageMonth', () => {
  it('follows Pacific time, because Google resets free usage at midnight Pacific on the 1st', () => {
    expect(usageMonth(new Date('2027-12-01T07:30:00Z'))).toBe('2027-11'); // 23:30 on Nov 30 in LA
    expect(usageMonth(new Date('2027-12-01T08:00:00Z'))).toBe('2027-12'); // midnight in LA
  });
});

describe('usage guard', () => {
  it('lets calls through up to the cap and refuses the next one', async () => {
    const guard = createUsageGuard({ db, caps: caps({ placeDetails: 3 }), now: November });

    await guard.consume('placeDetails');
    await guard.consume('placeDetails');
    await guard.consume('placeDetails');

    await expect(guard.consume('placeDetails')).rejects.toThrow(QuotaExceededError);
    expect((await guard.usage()).placeDetails).toBe(3);
  });

  it('counts units, and refuses a request that would cross the cap without counting it', async () => {
    const guard = createUsageGuard({ db, caps: caps({ routeMatrix: 10 }), now: November });

    await guard.consume('routeMatrix', 6);
    await expect(guard.consume('routeMatrix', 5)).rejects.toThrow(QuotaExceededError);
    expect((await guard.usage()).routeMatrix).toBe(6);

    await guard.consume('routeMatrix', 4);
    expect((await guard.usage()).routeMatrix).toBe(10);
  });

  it('keeps a separate count for each API', async () => {
    const guard = createUsageGuard({ db, caps: caps({ autocomplete: 1 }), now: November });

    await guard.consume('autocomplete');
    await guard.consume('computeRoutes');

    await expect(guard.consume('autocomplete')).rejects.toThrow(QuotaExceededError);
  });

  it('starts again in a new month', async () => {
    let current = new Date('2027-11-15T12:00:00Z');
    const guard = createUsageGuard({ db, caps: caps({ placeDetails: 1 }), now: () => current });
    await guard.consume('placeDetails');
    await expect(guard.consume('placeDetails')).rejects.toThrow(QuotaExceededError);

    current = new Date('2027-12-02T12:00:00Z');

    await guard.consume('placeDetails');
  });

  it('a cap of 0 switches an API off', async () => {
    const guard = createUsageGuard({ db, caps: caps({ autocomplete: 0 }), now: November });

    await expect(guard.consume('autocomplete')).rejects.toThrow(QuotaExceededError);
  });

  it('never lets parallel requests slip past the cap', async () => {
    const guard = createUsageGuard({ db, caps: caps({ computeRoutes: 5 }), now: November });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => guard.consume('computeRoutes')),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect((await guard.usage()).computeRoutes).toBe(5);
  });

  it('the refusal is a clear 429 for the client', async () => {
    const guard = createUsageGuard({ db, caps: caps({ autocomplete: 0 }), now: November });

    const error = await guard.consume('autocomplete').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 429, code: 'quota_reached' });
  });
});
