import { describe, expect, it, vi } from 'vitest';
import { memoizeAsync } from './memoizeAsync';

describe('memoizeAsync', () => {
  it('runs the work once, however many times it is asked for', async () => {
    const work = vi.fn(async () => 'engine');
    const get = memoizeAsync(work);

    const results = await Promise.all([get(), get(), get()]);

    expect(results).toEqual(['engine', 'engine', 'engine']);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('hands the same answer to later callers without working again', async () => {
    const work = vi.fn(async () => ({ id: 1 }));
    const get = memoizeAsync(work);

    const first = await get();
    const second = await get();

    expect(second).toBe(first);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure, instead of remembering the failure for ever', async () => {
    let attempts = 0;
    const get = memoizeAsync(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network down');
      return 'ok';
    });

    await expect(get()).rejects.toThrow('network down');
    await expect(get()).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });
});
