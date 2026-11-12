/** Minutes since midnight of the trip day. The solver never reads a clock. */
export type Minutes = number;

export interface LatLng {
  lat: number;
  lng: number;
}

/** When a place is open. One window per stage per day in beta. */
export interface TimeWindow {
  open: Minutes;
  close: Minutes;
}

export interface Stage {
  id: string;
  location: LatLng;
  /** Already resolved: stage override -> user preference -> system minimum. */
  stayMinutes: number;
  /** No window means always open. */
  window?: TimeWindow;
  /** The place is closed on the whole day. It stays in the route, flagged, never dropped. */
  closedAllDay?: boolean;
}

/**
 * Travel time in minutes. `departureTime` is ignored by beta implementations,
 * but the solver always passes the real departure time of the leg, so a
 * time-dependent implementation (public transit) can plug in later.
 */
export type TravelTimeFn = (from: LatLng, to: LatLng, departureTime: Minutes) => number;

export interface SolveInput {
  start: LatLng;
  end: LatLng;
  startTime: Minutes;
  stages: Stage[];
  travelTime: TravelTimeFn;
}

export interface Visit {
  stageId: string;
  arrival: Minutes;
  /** Arrival, or the opening time if we had to wait. */
  serviceStart: Minutes;
  departure: Minutes;
  /** Minutes spent waiting for the place to open. */
  waited: number;
}

export type Violation =
  /** The visit would end after the place closes. */
  | { stageId: string; kind: 'closed'; minutesLate: number }
  /** The stay is longer than the opening window itself; no order can fix it. */
  | { stageId: string; kind: 'window_too_short' }
  /** The place is closed on this whole day; no order can fix it. */
  | { stageId: string; kind: 'closed_all_day' };

export interface SolveResult {
  /** Stage ids in visiting order. Never missing a stage. */
  order: string[];
  visits: Visit[];
  /** When we arrive at the end point. */
  endArrival: Minutes;
  violations: Violation[];
  /** Sum of minutes late over all stages. */
  totalLateness: number;
}
