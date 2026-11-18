import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRedisRateLimiter, createRateLimiter } from '../rate-limit.js';
import { createRedis, type RedisConnection, type RedisHandle } from '../redis.js';
import { testRedisUrl } from '../test-redis.js';

let redis: RedisConnection;

beforeAll(async () => {
  redis = createRedis(testRedisUrl);
  for (let i = 0; i < 50 && !redis.isReady; i++) await new Promise((r) => setTimeout(r, 100));
});
beforeEach(async () => {
  await redis.flush();
});
afterAll(async () => {
  await redis.close();
});

const limiterOf = (
  options: Partial<Parameters<typeof createRedisRateLimiter>[0]> & { redis?: RedisHandle } = {},
) =>
  createRedisRateLimiter({
    redis: options.redis ?? redis,
    name: 'test',
    limit: 3,
    windowMs: 60_000,
    fallback: createRateLimiter({ limit: 3, windowMs: 60_000 }),
    ...options,
  });

describe('the Redis rate limiter (real Redis)', () => {
  it('allows up to the limit, then refuses', async () => {
    const limiter = limiterOf({ now: () => 1_000 });

    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await limiter.allow('ann'));

    expect(answers).toEqual([true, true, true, false]);
  });

  it('counts each user separately', async () => {
    const limiter = limiterOf({ limit: 1, now: () => 1_000 });

    expect(await limiter.allow('ann')).toBe(true);
    expect(await limiter.allow('bob')).toBe(true);
    expect(await limiter.allow('ann')).toBe(false);
  });

  it('starts a fresh count in the next window', async () => {
    let now = 1_000;
    const limiter = limiterOf({ limit: 1, now: () => now });
    expect(await limiter.allow('ann')).toBe(true);
    expect(await limiter.allow('ann')).toBe(false);

    now = 61_000; // the next minute

    expect(await limiter.allow('ann')).toBe(true);
  });

  it('lets exactly `limit` of 20 parallel requests through (INCR is atomic)', async () => {
    const limiter = limiterOf({ limit: 5, now: () => 1_000 });

    const answers = await Promise.all(Array.from({ length: 20 }, () => limiter.allow('ann')));

    expect(answers.filter(Boolean)).toHaveLength(5);
  });

  it('makes every key expire by itself, so nothing grows forever', async () => {
    const limiter = limiterOf({ now: () => 1_000 });
    await limiter.allow('ann');

    const keys = await redisKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^junro:rl:test:ann:/);
    expect(await ttlOf(keys[0]!)).toBeGreaterThan(0);
  });
});

describe('the Redis rate limiter when Redis is not there', () => {
  const stub = (overrides: Partial<RedisHandle>): RedisHandle => ({
    isReady: true,
    get: async () => null,
    set: async () => undefined,
    incrementWindow: async () => 1,
    ...overrides,
  });

  it('falls back to the in-memory limiter when Redis is not connected', async () => {
    const limiter = limiterOf({
      redis: stub({ isReady: false }),
      limit: 2,
      fallback: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    });

    const answers = [];
    for (let i = 0; i < 3; i++) answers.push(await limiter.allow('ann'));

    expect(answers).toEqual([true, true, false]);
  });

  it('falls back to the in-memory limiter when Redis fails', async () => {
    const broken = stub({
      incrementWindow: async () => {
        throw new Error('connection reset');
      },
    });
    const limiter = limiterOf({
      redis: broken,
      limit: 1,
      fallback: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });

    expect(await limiter.allow('ann')).toBe(true);
    expect(await limiter.allow('ann')).toBe(false);
  });
});

/** Reads straight from Redis, to look at what the limiter left behind. */
async function redisKeys(): Promise<string[]> {
  const { createClient } = await import('redis');
  const client = createClient({ url: testRedisUrl });
  await client.connect();
  try {
    return await client.keys('junro:rl:*');
  } finally {
    await client.quit();
  }
}
async function ttlOf(key: string): Promise<number> {
  const { createClient } = await import('redis');
  const client = createClient({ url: testRedisUrl });
  await client.connect();
  try {
    return await client.pTTL(key);
  } finally {
    await client.quit();
  }
}
