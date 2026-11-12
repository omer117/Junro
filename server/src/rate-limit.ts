export interface RateLimiter {
  /** True if this key may go ahead now (and counts it); false if it is over the limit. */
  allow(key: string): boolean;
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
    allow(key) {
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
