import { tryRedis, type RedisHandle } from './redis.js';

export interface RateLimiter {
  /** True if this key may go ahead now (and counts it); false if it is over the limit. */
  allow(key: string): Promise<boolean>;
}

/** A sliding window kept in memory: at most `limit` calls per key within `windowMs`. */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const calls = new Map<string, number[]>();

  return {
    async allow(key) {
      const current = now();
      const recent = (calls.get(key) ?? []).filter((time) => current - time < windowMs);
      if (recent.length >= limit) {
        calls.set(key, recent);
        return false;
      }
      recent.push(current);
      calls.set(key, recent);
      return true;
    },
  };
}

/**
 * The same limit shared by every server process and kept across restarts, using Redis.
 *
 * A fixed window: the key holds the window number, so a new minute is a new key. `INCR` adds one
 * atomically, so two parallel requests can never both read "9" and both go to 10. Every key
 * expires by itself (`PEXPIRE ... NX` sets the time once), so nothing grows forever.
 * Known cost: just across a window boundary up to twice the limit can pass. That is fine for a
 * limit whose job is to stop a runaway client before it reaches the Google usage guard.
 *
 * When Redis is missing, down or slow, the in-memory `fallback` decides.
 */
export function createRedisRateLimiter(options: {
  redis: RedisHandle;
  /** Part of the key, so the limiters (search, solve...) do not share a counter. */
  name: string;
  limit: number;
  windowMs: number;
  fallback: RateLimiter;
  now?: () => number;
}): RateLimiter {
  const { redis, name, limit, windowMs, fallback } = options;
  const now = options.now ?? Date.now;

  return {
    allow: (key) =>
      tryRedis(
        redis,
        async (client) => {
          const window = Math.floor(now() / windowMs);
          const count = await client.incrementWindow(`junro:rl:${name}:${key}:${window}`, windowMs);
          return count <= limit;
        },
        () => fallback.allow(key),
      ),
  };
}
