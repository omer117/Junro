import { GooglePlaceNotFoundError, GoogleRejectedError, GoogleUnavailableError } from './errors.js';
import type { MapsClient, OpeningHours, PlaceSuggestion } from './types.js';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** What Google sends for a place, limited to the fields we ask for. */
interface RawPlace {
  id: string;
  displayName?: { text?: string };
  location: { latitude: number; longitude: number };
  regularOpeningHours?: OpeningHours;
}

export interface HttpMapsClientOptions {
  apiKey: string;
  /** Replaceable so tests never touch the network. */
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Where the reason for a rejection is written for the operator. Defaults to the server log. */
  log?: (message: string) => void;
}

/** The real Google client. The API key is added here, on the server, and goes nowhere else. */
export function createHttpMapsClient(options: HttpMapsClientOptions): MapsClient {
  const { apiKey, timeoutMs = 8000 } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  const fetchFn: FetchFn = options.fetch ?? ((url, init) => fetch(url, init));

  /** Google's explanation (status and message), shortened, with our API key taken out. */
  async function reason(response: Response): Promise<string> {
    let raw: string;
    try {
      raw = await response.text();
    } catch {
      return '(no details)';
    }

    // Google usually sends { error: { status, message } }, sometimes wrapped in a list.
    let text = raw.trim();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const body = (Array.isArray(parsed) ? parsed[0] : parsed) as
        { error?: { status?: string; message?: string } } | undefined;
      const known = `${body?.error?.status ?? ''} ${body?.error?.message ?? ''}`.trim();
      if (known) text = known;
    } catch {
      // not JSON: the raw text is all we have
    }
    return (text || '(empty response)').split(apiKey).join('[key removed]').slice(0, 400);
  }

  /**
   * One Google request. Any failure becomes one of our clear errors. `notFoundStatuses` are
   * the statuses that mean "no such thing" for this particular call.
   */
  async function call(
    method: 'GET' | 'POST',
    url: string,
    options: { body?: unknown; fieldMask?: string; notFoundStatuses?: number[] } = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          ...(options.fieldMask ? { 'X-Goog-FieldMask': options.fieldMask } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(timeoutMs), // never wait forever
      });
    } catch {
      throw new GoogleUnavailableError();
    }

    // Google's own error text can repeat our key back, so it is never passed on.
    if (response.status >= 500 || response.status === 429) throw new GoogleUnavailableError();
    if (options.notFoundStatuses?.includes(response.status)) throw new GooglePlaceNotFoundError();
    if (!response.ok) {
      // The client only ever sees "Google rejected the request". The reason goes to the
      // server log (with the key removed), so whoever runs the server can fix the setup.
      log(`Google rejected a request (${response.status}): ${await reason(response)}`);
      throw new GoogleRejectedError(response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new GoogleUnavailableError();
    }
  }

  return {
    async autocomplete({ query, sessionToken }) {
      const data = (await call('POST', 'https://places.googleapis.com/v1/places:autocomplete', {
        body: { input: query, sessionToken },
      })) as {
        suggestions?: Array<{ placePrediction?: { placeId: string; text?: { text?: string } } }>;
      };

      const result: PlaceSuggestion[] = [];
      for (const suggestion of data.suggestions ?? []) {
        const prediction = suggestion.placePrediction;
        if (prediction) {
          result.push({ googlePlaceId: prediction.placeId, text: prediction.text?.text ?? '' });
        }
      }
      return result;
    },

    async placeDetails({ googlePlaceId, sessionToken }) {
      const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
      const data = (await call(
        'GET',
        `https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}${query}`,
        {
          // The field mask decides the price. Opening hours put this call in the Enterprise tier
          // (1,000 free per month), which is why a place is fetched once and then stored.
          fieldMask: 'id,displayName,location,regularOpeningHours',
          notFoundStatuses: [400, 404],
        },
      )) as RawPlace;

      return {
        googlePlaceId: data.id,
        name: data.displayName?.text ?? '',
        lat: data.location.latitude,
        lng: data.location.longitude,
        openingHours: data.regularOpeningHours ?? null,
      };
    },

    async routeMatrix({ origins, destinations, mode }) {
      // Refuse here what Google would refuse anyway, so a bad request never spends quota.
      if (origins.length === 0 || destinations.length === 0) return [];
      if (origins.length > 25 || destinations.length > 25) {
        throw new RangeError('A route matrix takes at most 25 origins and 25 destinations');
      }
      if (origins.length * destinations.length > 625) {
        throw new RangeError('A route matrix takes at most 625 elements');
      }

      const waypoint = (p: { lat: number; lng: number }) => ({
        waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
      });
      const data = (await call(
        'POST',
        'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
        {
          fieldMask: 'originIndex,destinationIndex,duration,condition',
          body: {
            origins: origins.map(waypoint),
            destinations: destinations.map(waypoint),
            travelMode: mode === 'walking' ? 'WALK' : 'DRIVE',
            // Without live traffic: the cheaper tier, and traffic is not part of the beta.
            ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
          },
        },
      )) as Array<{
        originIndex?: number;
        destinationIndex?: number;
        duration?: string;
        condition?: string;
      }>;

      // Anything Google does not report as a route stays Infinity.
      const seconds = origins.map(() => destinations.map(() => Infinity));
      for (const element of Array.isArray(data) ? data : []) {
        if (element.condition === 'ROUTE_EXISTS' && element.duration) {
          seconds[element.originIndex ?? 0]![element.destinationIndex ?? 0] = parseFloat(
            element.duration,
          );
        }
      }
      return seconds;
    },

    async computeRoute({ origin, destination, intermediates, mode }) {
      if (intermediates.length > 25) {
        throw new RangeError('A route takes at most 25 stops in between');
      }
      const waypoint = (p: { lat: number; lng: number }) => ({
        location: { latLng: { latitude: p.lat, longitude: p.lng } },
      });
      const data = (await call(
        'POST',
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          // Only the line is needed; asking for more fields would move the call to a pricier tier.
          fieldMask: 'routes.polyline.encodedPolyline',
          body: {
            origin: waypoint(origin),
            destination: waypoint(destination),
            intermediates: intermediates.map(waypoint),
            travelMode: mode === 'walking' ? 'WALK' : 'DRIVE',
            ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
          },
        },
      )) as { routes?: Array<{ polyline?: { encodedPolyline?: string } }> };

      const line = data.routes?.[0]?.polyline?.encodedPolyline;
      if (!line) throw new GoogleRejectedError(200);
      return line;
    },
  };
}
