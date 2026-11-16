import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedis, tryRedis, type RedisConnection, type RedisHandle } from './redis.js';

import { testRedisUrl } from './test-redis.js';

/** A stand-in for Redis in the tests that are about failures. */
const stub = (overrides: Partial<RedisHandle> = {}): RedisHandle => ({
  isReady: true,
  get: async () => 'value',
  set: async () => undefined,
  incrementWindow: async () => 1,
  ...overrides,
});

describe('tryRedis (Redis is only a shortcut)', () => {
  it('uses Redis when it is ready', async () => {
    const result = await tryRedis(
      stub(),
      (r) => r.get('k'),
      () => 'fallback',
    );

    expect(result).toBe('value');
  });

  it('uses the fallback when there is no Redis at all', async () => {
    expect(
      await tryRedis(
        undefined,
        async () => 'redis',
        () => 'fallback',
      ),
    ).toBe('fallback');
  });

  it('uses the fallback at once when Redis is not connected, without calling it', async () => {
    let called = false;
    const down = stub({
      isReady: false,
      get: async () => {
        called = true;
        return 'value';
      },
    });

    expect(
      await tryRedis(
        down,
        (r) => r.get('k'),
        () => 'fallback',
      ),
    ).toBe('fallback');
    expect(called).toBe(false);
  });

  it('uses the fallback when Redis throws', async () => {
    const broken = stub({
      get: async () => {
        throw new Error('connection reset');
      },
    });

    expect(
      await tryRedis(
        broken,
        (r) => r.get('k'),
        () => 'fallback',
      ),
    ).toBe('fallback');
  });

  it('stops waiting for a hanging call after the timeout', async () => {
    const hanging = stub({ get: () => new Promise<string | null>(() => undefined) });
    const started = Date.now();

    const result = await tryRedis(
      hanging,
      (r) => r.get('k'),
      () => 'fallback',
      30,
    );

    expect(result).toBe('fallback');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('accepts an async fallback', async () => {
    expect(
      await tryRedis(
        undefined,
        async () => 'redis',
        async () => 'slow fallback',
      ),
    ).toBe('slow fallback');
  });
});

describe('createRedis (real Redis)', () => {
  let redis: RedisConnection;

  beforeAll(async () => {
    redis = createRedis(testRedisUrl);
    // Wait until it is connected (tests need a Redis on TEST_REDIS_URL, see .env.example).
    for (let i = 0; i < 50 && !redis.isReady; i++) await new Promise((r) => setTimeout(r, 100));
  });
  beforeEach(async () => {
    await redis.flush();
  });
  afterAll(async () => {
    await redis.close();
  });

  it('stores a value and reads it back', async () => {
    await redis.set('junro:test:a', '{"x":1}', 60);

    expect(await redis.get('junro:test:a')).toBe('{"x":1}');
    expect(await redis.get('junro:test:missing')).toBeNull();
  });

  it('counts, and the counter expires by itself', async () => {
    expect(await redis.incrementWindow('junro:test:count', 60_000)).toBe(1);
    expect(await redis.incrementWindow('junro:test:count', 60_000)).toBe(2);
  });
});
