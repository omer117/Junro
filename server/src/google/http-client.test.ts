import { describe, expect, it, vi } from 'vitest';
import { GoogleRejectedError, GoogleUnavailableError } from './errors.js';
import { createHttpMapsClient } from './http-client.js';

/** A fake `fetch` that records the request and answers with the given status and body. */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

describe('autocomplete', () => {
  it('sends the query with the API key and session token, and keeps only place predictions', async () => {
    const fetch = fakeFetch(200, {
      suggestions: [
        { placePrediction: { placeId: 'abc', text: { text: 'Senso-ji, Asakusa, Taito City' } } },
        { queryPrediction: { text: { text: 'senso ji hotels' } } },
        { placePrediction: { placeId: 'def', text: { text: 'Sensoji Station' } } },
      ],
    });
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const result = await client.autocomplete({ query: 'senso', sessionToken: 'session-1' });

    expect(result).toEqual([
      { googlePlaceId: 'abc', text: 'Senso-ji, Asakusa, Taito City' },
      { googlePlaceId: 'def', text: 'Sensoji Station' },
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('KEY');
    expect(JSON.parse(String(init?.body))).toEqual({ input: 'senso', sessionToken: 'session-1' });
    expect(init?.signal).toBeInstanceOf(AbortSignal); // never wait forever
  });

  it('returns an empty list when Google has no suggestions', async () => {
    const client = createHttpMapsClient({ apiKey: 'K', fetch: fakeFetch(200, {}) });

    expect(await client.autocomplete({ query: 'zzzz', sessionToken: 's' })).toEqual([]);
  });

  it('reports a Google server error as unavailable', async () => {
    const client = createHttpMapsClient({ apiKey: 'K', fetch: fakeFetch(503, {}) });

    await expect(client.autocomplete({ query: 'abc', sessionToken: 's' })).rejects.toThrow(
      GoogleUnavailableError,
    );
  });

  it('reports a network failure as unavailable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createHttpMapsClient({ apiKey: 'K', fetch });

    await expect(client.autocomplete({ query: 'abc', sessionToken: 's' })).rejects.toThrow(
      GoogleUnavailableError,
    );
  });

  it('reports a refused request (bad key, API disabled) as rejected, without leaking the key', async () => {
    const client = createHttpMapsClient({
      apiKey: 'SECRET-KEY',
      fetch: fakeFetch(403, { error: { message: 'API key SECRET-KEY is not valid' } }),
    });

    const error = await client.autocomplete({ query: 'abc', sessionToken: 's' }).catch((e) => e);

    expect(error).toBeInstanceOf(GoogleRejectedError);
    expect(JSON.stringify(error.message)).not.toContain('SECRET-KEY');
  });
});
