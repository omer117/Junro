/** Minutes since midnight of the trip day. The solver never reads a clock. */
export type Minutes = number;

export interface LatLng {
  lat: number;
  lng: number;
}

/** One stretch of time a place is open. A place can have several per day (lunch break). */
export interface TimeWindow {
  open: Minutes;
  close: Minutes;
}

export interface Stage {
  id: string;
  location: LatLng;
  /** Already resolved: stage override -> user preference -> system minimum. */
  stayMinutes: number;
  /**
   * The opening windows of the day: sorted, not touching, not empty. A visit fits inside ONE
   * window (it never spans a break). Missing means always open. Windows may run past 1440 for a
   * place that is open after midnight.
   */
  windows?: TimeWindow[];
  /** The place is closed on the whole day. A must stays in the route, flagged; an optional one is dropped. */
  closedAllDay?: boolean;
  /**
   * `must` (the default) is never dropped. `optional` ("if there is time") is left out when keeping
   * it would make the day late; it is always reported in `SolveResult.dropped`, never silently.
   */
  priority?: 'must' | 'optional';
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
  /** When the day should end at the latest (back at the end point). Missing means no limit. */
  endTime?: Minutes;
}

export interface Visit {
  stageId: string;
  arrival: Minutes;
  /** Arrival, or the opening time if we had to wait. */
  serviceStart: Minutes;
  departure: Minutes;
  /** Minutes spent waiting for the place to open. */
  waited: number;
  /** The opening window this visit was planned in (missing when the place has no limit). */
  window?: TimeWindow;
}

export type Violation =
  /** The visit would end after the place closes. */
  | { stageId: string; kind: 'closed'; minutesLate: number }
  /** The stay is longer than every opening window of the day; no order can fix it. */
  | { stageId: string; kind: 'window_too_short' }
  /** The place is closed on this whole day; no order can fix it. */
  | { stageId: string; kind: 'closed_all_day' }
  /** We reach the end point after the day end time (even without the optional stops). */
  | { kind: 'past_day_end'; minutesLate: number };

export interface SolveResult {
  /** Stage ids in visiting order. Every must stage is in it; optional stages may be left out. */
  order: string[];
  visits: Visit[];
  /** When we arrive at the end point. */
  endArrival: Minutes;
  violations: Violation[];
  /** Sum of minutes late over all stages, plus the minutes past the day end time. */
  totalLateness: number;
  /**
   * Optional stage ids that were left out, in input order. `solve` fills it; `evaluateOrder`
   * judges the order it is given and always answers an empty list.
   */
  dropped: string[];
}
