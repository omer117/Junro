export interface Leg {
  mode: 'walk' | 'transit';
  minutes: number;
}

/** One step of a public transport option: walking, or riding a line. */
export interface TransitStep {
  kind: 'walk' | 'transit';
  minutes: number;
  line?: string;
  vehicle?: string;
  stops?: number;
  headsign?: string;
}

/** One way of making a leg by public transport. */
export interface TransitOption {
  minutes: number;
  walkMinutes: number;
  transfers: number;
  steps: TransitStep[];
}

export interface Visit {
  stageId: string;
  /** Minutes since midnight. */
  arrival: number;
  /** When the visit starts: the arrival, or the opening time if you have to wait. */
  serviceStart: number;
  departure: number;
  /** Minutes spent waiting for the place to open. */
  waited: number;
}

export type Violation =
  | { stageId: string; kind: 'closed'; minutesLate: number }
  | { stageId: string; kind: 'window_too_short' }
  | { stageId: string; kind: 'closed_all_day' };

/** A route as the server sends it (from "Find my route", or the saved one). */
export interface RouteResult {
  mode: 'full' | 'minimal' | 'saved';
  /** Stop ids in visiting order. */
  order: string[];
  visits: Visit[];
  /** When you reach the end of the day, in minutes since midnight. */
  endArrival: number;
  violations: Violation[];
  totalLateness: number;
  /** Set when the day was replanned mid-day: where the person was, and the time (minutes). */
  live: { lat: number; lng: number; time: number } | null;
  /**
   * Public transport days: each leg of the route (start to first stop, stop to stop, last stop to
   * end), on foot or by public transport, and how long it takes.
   */
  legs?: Leg[];
  /** The encoded line to draw on the map, or null. */
  routeLine: string | null;
  /** Set when only the line failed: the order and times are still good. */
  routeLineError?: string;
}
