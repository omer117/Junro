import type { LatLng, Minutes, SolveResult, Stage, TravelTimeFn } from '../types.js';

/** One day of a stay (the days of one city): where it starts and ends, and when. */
export interface SplitDay {
  id: string;
  start: LatLng;
  end: LatLng;
  startTime: Minutes;
  /** When the day should end at the latest. Missing: the split plans as if it were 22:00. */
  endTime?: Minutes;
}

export interface SplitPlace {
  id: string;
  location: LatLng;
  stayMinutes: number;
  priority: 'must' | 'optional';
  /** Index-aligned with `days`: that date's opening windows (or closedAllDay). */
  hours: Array<Pick<Stage, 'windows' | 'closedAllDay'>>;
  /** Booked: this place is visited on that day (index) at about that time. Always a must. */
  pin?: { day: number; time: Minutes };
}

export interface SplitInput {
  days: SplitDay[];
  places: SplitPlace[];
  /** The current day (index) of each place, so a re-run stays stable. Missing: start from scratch. */
  current?: Record<string, number>;
  travelTime: TravelTimeFn;
  /** Work units the local search may spend (see `workUnitsOf`). */
  budget?: number;
}

export interface SplitResult {
  days: Array<{ dayId: string; result: SolveResult }>;
  /** Places that are on no day, with the reason. Never silent. */
  leftOut: Array<{ id: string; reason: 'did_not_fit' | 'closed_all_days' }>;
  /** What the split was judged on (lower is better, compared in this order). */
  score: { lateness: number; droppedOptional: number; travel: number; imbalance: number };
  /** True when the budget ran out before no move improved. The result is still valid. */
  exhausted: boolean;
  /** Work units spent on exact day solves. */
  workUnits: number;
}
