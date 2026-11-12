import type { LatLng } from '@junro/solver';
import type { TravelMode } from '../db/schema.js';

/** One suggestion from the search box. */
export interface PlaceSuggestion {
  googlePlaceId: string;
  /** Human text such as "Senso-ji, Asakusa, Taito City". */
  text: string;
}

/** Opening hours exactly as Google sends them (regularOpeningHours). Weekdays: 0 = Sunday. */
export interface OpeningHours {
  periods?: Array<{
    open: { day: number; hour: number; minute: number };
    /** Missing for a place that is open around the clock. */
    close?: { day: number; hour: number; minute: number };
  }>;
}

export interface PlaceDetails {
  googlePlaceId: string;
  name: string;
  lat: number;
  lng: number;
  /** null when Google has no opening hours for the place. */
  openingHours: OpeningHours | null;
}

/**
 * Everything the server asks of Google, as plain functions. The real implementation talks
 * HTTP (http-client.ts); tests use a fake (test-maps.ts). Whatever uses this never knows
 * the difference, and never sees the API key.
 */
export interface MapsClient {
  autocomplete(input: { query: string; sessionToken: string }): Promise<PlaceSuggestion[]>;
  /** Billed per call, so callers fetch a place once and store it. */
  placeDetails(input: { googlePlaceId: string; sessionToken?: string }): Promise<PlaceDetails>;
  /**
   * Travel times in seconds: result[i][j] is origins[i] -> destinations[j], Infinity when there
   * is no route. Billed per element (origins x destinations).
   */
  routeMatrix(input: {
    origins: LatLng[];
    destinations: LatLng[];
    mode: TravelMode;
  }): Promise<number[][]>;
  /** The route through the stops in order, as an encoded polyline for the map. One call. */
  computeRoute(input: {
    origin: LatLng;
    destination: LatLng;
    intermediates: LatLng[];
    mode: TravelMode;
  }): Promise<string>;
}
