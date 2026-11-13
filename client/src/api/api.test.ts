import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('calls the server under /api and returns the JSON body', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { id: '1' }));
    vi.stubGlobal('fetch', fetch);

    const result = await api<{ id: string }>('/trips');

    expect(result).toEqual({ id: '1' });
    expect(fetch.mock.calls[0]![0]).toBe('/api/trips');
  });

  it('sends a JSON body with the right header', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(201, { id: '1' }));
    vi.stubGlobal('fetch', fetch);

    await api('/trips', { method: 'POST', body: { name: 'Japan' } });

    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Japan' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    expect(await api('/trips/1', { method: 'DELETE' })).toBeUndefined();
  });

  it("turns the server's error shape into an ApiError", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(429, { error: { code: 'quota_reached', message: 'The monthly limit is reached.' } }),
      ),
    );

    const error = await api('/days/1/solve', { method: 'POST' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'quota_reached',
      message: 'The monthly limit is reached.',
    });
  });

  it('keeps the list of problems from a validation error', async () => {
    const details = [{ path: 'name', message: 'Too small' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(400, { error: { code: 'validation_error', message: 'Bad', details } }),
      ),
    );

    const error = (await api('/trips', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error.details).toEqual(details);
  });

  it('gives a readable error when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const error = await api('/trips').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'network' });
  });

  it('gives a readable error when the answer is not what the server normally sends', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })),
    );

    const error = await api('/trips').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502, code: 'unexpected_response' });
  });
});
