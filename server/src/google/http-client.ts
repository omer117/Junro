import { GooglePlaceNotFoundError, GoogleRejectedError, GoogleUnavailableError } from './errors.js';
import type {
  MapsClient,
  OpeningHours,
  PlaceSuggestion,
  TransitOption,
  TransitStep,
} from './types.js';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** What Google sends for a place, limited to the fields we ask for. */
interface RawPlace {
  id: string;
  displayName?: { text?: string };
  location: { latitude: number; longitude: number };
  regularOpeningHours?: OpeningHours;
}

const GOOGLE_MODE = { walking: 'WALK', driving: 'DRIVE', transit: 'TRANSIT' } as const;

/** What Google sends for one public transport route, limited to the fields we ask for. */
interface RawTransitRoute {
  duration?: string;
  legs?: Array<{
    steps?: Array<{
      travelMode?: string;
      staticDuration?: string;
      transitDetails?: {
        headsign?: string;
        stopCount?: number;
        transitLine?: { name?: string; nameShort?: string; vehicle?: { type?: string } };
      };
    }>;
  }>;
}

const minutesOf = (duration: string | undefined): number =>
  duration ? Math.round(parseFloat(duration) / 60) : 0;

/** One Google route as a plain option: how long, how much walking, how many changes, the steps. */
function toTransitOption(route: RawTransitRoute): TransitOption {
  const steps: TransitStep[] = (route.legs ?? [])
    .flatMap((leg) => leg.steps ?? [])
    .map((step): TransitStep => {
      if (step.travelMode !== 'TRANSIT') {
        return { kind: 'walk', minutes: minutesOf(step.staticDuration) };
      }
      const details = step.transitDetails;
      const line = details?.transitLine?.name ?? details?.transitLine?.nameShort;
      return {
        kind: 'transit',
        minutes: minutesOf(step.staticDuration),
        ...(line ? { line } : {}),
        ...(details?.transitLine?.vehicle?.type
          ? { vehicle: details.transitLine.vehicle.type }
          : {}),
        ...(details?.stopCount !== undefined ? { stops: details.stopCount } : {}),
        ...(details?.headsign ? { headsign: details.headsign } : {}),
      };
    });
  // Walking steps that follow each other are one walk, and a walk of no time is not shown.
  const merged: TransitStep[] = [];
  for (const step of steps) {
    const last = merged[merged.length - 1];
    if (step.kind === 'walk' && step.minutes === 0) continue;
    if (step.kind === 'walk' && last?.kind === 'walk') last.minutes += step.minutes;
    else merged.push({ ...step });
  }
  const rides = merged.filter((step) => step.kind === 'transit').length;
  return {
    minutes: minutesOf(route.duration),
    walkMinutes: merged.filter((s) => s.kind === 'walk').reduce((sum, s) => sum + s.minutes, 0),
    transfers: Math.max(rides - 1, 0),
    steps: merged,
  };
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
    async autocomplete({ query, sessionToken, near }) {
      const data = (await call('POST', 'https://places.googleapis.com/v1/places:autocomplete', {
        body: {
          input: query,
          sessionToken,
          // A bias, not a restriction: a person searching for a place far away still finds it.
          ...(near
            ? {
                locationBias: {
                  circle: {
                    center: { latitude: near.lat, longitude: near.lng },
                    radius: 50_000,
                  },
                },
              }
            : {}),
        },
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

    async routeMatrix({ origins, destinations, mode, departureTime }) {
      // Refuse here what Google would refuse anyway, so a bad request never spends quota.
      if (origins.length === 0 || destinations.length === 0) return [];
      if (origins.length > 25 || destinations.length > 25) {
        throw new RangeError('A route matrix takes at most 25 origins and 25 destinations');
      }
      if (origins.length * destinations.length > 625) {
        throw new RangeError('A route matrix takes at most 625 elements');
      }

      // Google allows fewer elements per request for public transport.
      if (mode === 'transit' && origins.length * destinations.length > 100) {
        throw new RangeError('A transit route matrix takes at most 100 elements');
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
            travelMode: GOOGLE_MODE[mode],
            // Without live traffic: the cheaper tier, and traffic is not part of the beta.
            ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
            ...(mode === 'transit' && departureTime ? { departureTime } : {}),
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

    async computeRoute({ origin, destination, intermediates, mode, departureTime }) {
      if (intermediates.length > 25) {
        throw new RangeError('A route takes at most 25 stops in between');
      }
      if (mode === 'transit' && intermediates.length > 0) {
        throw new RangeError('A public transport route cannot have stops in between');
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
            ...(intermediates.length > 0 ? { intermediates: intermediates.map(waypoint) } : {}),
            travelMode: GOOGLE_MODE[mode],
            ...(mode === 'driving' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
            ...(mode === 'transit' && departureTime ? { departureTime } : {}),
          },
        },
      )) as { routes?: Array<{ polyline?: { encodedPolyline?: string } }> };

      const line = data.routes?.[0]?.polyline?.encodedPolyline;
      if (!line) throw new GoogleRejectedError(200);
      return line;
    },

    async transitAlternatives({ origin, destination, departureTime }) {
      const waypoint = (p: { lat: number; lng: number }) => ({
        location: { latLng: { latitude: p.lat, longitude: p.lng } },
      });
      const data = (await call(
        'POST',
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          // Only what the options need: how long, and the steps with their lines.
          fieldMask:
            'routes.duration,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails',
          body: {
            origin: waypoint(origin),
            destination: waypoint(destination),
            travelMode: 'TRANSIT',
            departureTime,
            computeAlternativeRoutes: true,
            // Line names in English, not in the local script (Hebrew, Japanese...).
            languageCode: 'en',
          },
        },
      )) as { routes?: RawTransitRoute[] };
      // Google sometimes sends the same option twice: show each once.
      const seen = new Set<string>();
      return (data.routes ?? []).map(toTransitOption).filter((option) => {
        const signature = JSON.stringify(option);
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
    },
  };
}
