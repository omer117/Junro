import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

describe('rate limiter', () => {
  it('allows up to the limit within the window, then refuses', () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect([1, 2, 3, 4].map(() => limiter.allow('ann'))).toEqual([true, true, true, false]);
  });

  it('keeps a separate count per key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });

    expect(limiter.allow('ann')).toBe(true);
    expect(limiter.allow('bob')).toBe(true);
    expect(limiter.allow('ann')).toBe(false);
  });

  it('allows again once the window has passed', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    limiter.allow('ann');

    now = 60_001;

    expect(limiter.allow('ann')).toBe(true);
  });
});
