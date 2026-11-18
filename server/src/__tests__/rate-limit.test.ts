import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../rate-limit.js';

describe('rate limiter', () => {
  it('allows up to the limit within the window, then refuses', async () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await limiter.allow('ann'));
    expect(answers).toEqual([true, true, true, false]);
  });

  it('keeps a separate count per key', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });

    expect(await limiter.allow('ann')).toBe(true);
    expect(await limiter.allow('bob')).toBe(true);
    expect(await limiter.allow('ann')).toBe(false);
  });

  it('allows again once the window has passed', async () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    await limiter.allow('ann');

    now = 60_001;

    expect(await limiter.allow('ann')).toBe(true);
  });
});
