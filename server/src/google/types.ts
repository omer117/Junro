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

/** One step of a public transport option: walking, or riding a line. */
export interface TransitStep {
  kind: 'walk' | 'transit';
  minutes: number;
  /** Riding: the line's name, for example "Ginza Line". */
  line?: string;
  /** Riding: what it is (SUBWAY, BUS, TRAIN...), as Google names it. */
  vehicle?: string;
  /** Riding: how many stops. */
  stops?: number;
  /** Riding: where the vehicle is heading. */
  headsign?: string;
}

/** One way of getting from A to B by public transport. */
export interface TransitOption {
  minutes: number;
  /** All the walking in it (to the stop, between stops, and from the last stop). */
  walkMinutes: number;
  /** How many times you change vehicle. */
  transfers: number;
  steps: TransitStep[];
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
  /** `near` makes results around that place come first (a preference, not a limit). */
  autocomplete(input: {
    query: string;
    sessionToken: string;
    near?: LatLng;
  }): Promise<PlaceSuggestion[]>;
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
    /** Public transport only: the exact moment to leave (ISO timestamp). Timetables depend on it. */
    departureTime?: string;
  }): Promise<number[][]>;
  /** The route through the stops in order, as an encoded polyline for the map. One call. */
  computeRoute(input: {
    origin: LatLng;
    destination: LatLng;
    intermediates: LatLng[];
    mode: TravelMode;
    /** Public transport only (and no stops in between: Google does not allow them). */
    departureTime?: string;
  }): Promise<string>;
  /** Up to a few ways of going from A to B by public transport, as Google ranks them. One call. */
  transitAlternatives(input: {
    origin: LatLng;
    destination: LatLng;
    departureTime: string;
  }): Promise<TransitOption[]>;
}
