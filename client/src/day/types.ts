import type { Category } from '../categories';
import type { Day } from '../trips/types';

/** A day with the names of its two ends. */
export interface DayDetail extends Day {
  startName: string | null;
  endName: string | null;
  /** When the day should end at the latest (minutes since midnight), or null for no limit. */
  endTime?: number | null;
  /** Google's ids of the start and end places, when they were chosen from a search. */
  startPlaceId?: string | null;
  endPlaceId?: string | null;
}

export interface Stage {
  id: string;
  /** The day, or null while the place waits in the pool of its stay. */
  dayId: string | null;
  /** The stay this place belongs to (when it is part of one). */
  segmentId?: string | null;
  /** Booked for this time (minutes since midnight), or null. */
  pinnedTime?: number | null;
  category: Category;
  stayOverrideMinutes: number | null;
  done: boolean;
  /** `must` is never left out; `optional` ("if there is time") may be. */
  priority: 'must' | 'optional';
  /** Left out of the route by the last calculation because it would not fit. */
  dropped: boolean;
  /** Place in the route (0 = first), or null before the day has been solved. */
  position: number | null;
  place: { id: string; googlePlaceId: string; name: string; lat: number; lng: number };
}
