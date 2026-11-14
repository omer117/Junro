import { describe, expect, it, vi } from 'vitest';
import { GooglePlaceNotFoundError, GoogleRejectedError, GoogleUnavailableError } from './errors.js';
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

describe('autocomplete near a place', () => {
  it('asks Google to prefer results within 50 km of that place (a preference, not a limit)', async () => {
    const fetch = fakeFetch(200, { suggestions: [] });
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    await client.autocomplete({
      query: 'shinjuku',
      sessionToken: 'session-1',
      near: { lat: 35.69, lng: 139.7 },
    });

    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      input: 'shinjuku',
      sessionToken: 'session-1',
      locationBias: { circle: { center: { latitude: 35.69, longitude: 139.7 }, radius: 50000 } },
    });
  });
});

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

describe('placeDetails', () => {
  const details = {
    id: 'abc',
    displayName: { text: 'Senso-ji', languageCode: 'en' },
    location: { latitude: 35.7148, longitude: 139.7967 },
    regularOpeningHours: { periods: [{ open: { day: 0, hour: 6, minute: 0 } }] },
  };

  it('asks only for the fields we use, and reads them', async () => {
    const fetch = fakeFetch(200, details);
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const place = await client.placeDetails({ googlePlaceId: 'abc', sessionToken: 'session-1' });

    expect(place).toEqual({
      googlePlaceId: 'abc',
      name: 'Senso-ji',
      lat: 35.7148,
      lng: 139.7967,
      openingHours: details.regularOpeningHours,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://places.googleapis.com/v1/places/abc?sessionToken=session-1');
    expect(init?.method).toBe('GET');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('KEY');
    // The field mask decides the price: nothing beyond these four.
    expect(headers['X-Goog-FieldMask']).toBe('id,displayName,location,regularOpeningHours');
  });

  it('gives null opening hours when Google has none', async () => {
    const withoutHours = { ...details, regularOpeningHours: undefined };
    const client = createHttpMapsClient({ apiKey: 'K', fetch: fakeFetch(200, withoutHours) });

    expect((await client.placeDetails({ googlePlaceId: 'abc' })).openingHours).toBeNull();
  });

  it.each([400, 404])('reports status %i as a place that does not exist', async (status) => {
    const client = createHttpMapsClient({ apiKey: 'K', fetch: fakeFetch(status, {}) });

    await expect(client.placeDetails({ googlePlaceId: 'nope-nope-nope' })).rejects.toThrow(
      GooglePlaceNotFoundError,
    );
  });
});

describe('routeMatrix', () => {
  const a = { lat: 35.68, lng: 139.76 };
  const b = { lat: 35.71, lng: 139.8 };
  const answer = [
    { originIndex: 0, destinationIndex: 0, duration: '0s', condition: 'ROUTE_EXISTS' },
    { originIndex: 0, destinationIndex: 1, duration: '600s', condition: 'ROUTE_EXISTS' },
    { originIndex: 1, destinationIndex: 0, duration: '660s', condition: 'ROUTE_EXISTS' },
    { originIndex: 1, destinationIndex: 1, duration: '0s', condition: 'ROUTE_EXISTS' },
  ];

  it('sends the points and the mode, asks for only the fields we use, and returns seconds', async () => {
    const fetch = fakeFetch(200, answer);
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    const seconds = await client.routeMatrix({
      origins: [a, b],
      destinations: [a, b],
      mode: 'walking',
    });

    expect(seconds).toEqual([
      [0, 600],
      [660, 0],
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toBe('originIndex,destinationIndex,duration,condition');
    const body = JSON.parse(String(init?.body));
    expect(body.travelMode).toBe('WALK');
    expect(body.routingPreference).toBeUndefined();
    expect(body.origins[0]).toEqual({
      waypoint: { location: { latLng: { latitude: 35.68, longitude: 139.76 } } },
    });
  });

  it('uses the cheaper traffic-unaware preference for driving', async () => {
    const fetch = fakeFetch(200, answer);
    const client = createHttpMapsClient({ apiKey: 'KEY', fetch });

    await client.routeMatrix({ origins: [a, b], destinations: [a, b], mode: 'driving' });

    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
  });

  it('reports a pair without a route, or missing from the answer, as Infinity', async () => {
    const client = createHttpMapsClient({
      apiKey: 'K',
      fetch: fakeFetch(200, [
        { originIndex: 0, destinationIndex: 0, duration: '0s', condition: 'ROUTE_EXISTS' },
        { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
        { originIndex: 1, destinationIndex: 0, duration: '60s', condition: 'ROUTE_EXISTS' },
      ]),
    });

    const seconds = await client.routeMatrix({
      origins: [a, b],
      destinations: [a, b],
      mode: 'walking',
    });

    expect(seconds).toEqual([
      [0, Infinity],
      [60, Infinity],
    ]);
  });

  it('refuses a request Google would reject, without spending a call', async () => {
    const fetch = fakeFetch(200, []);
    const client = createHttpMapsClient({ apiKey: 'K', fetch });
    const many = Array.from({ length: 26 }, () => a);

    await expect(
      client.routeMatrix({ origins: many, destinations: [a], mode: 'walking' }),
    ).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
