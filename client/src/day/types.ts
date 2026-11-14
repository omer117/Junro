import type { Category } from '../categories';
import type { Day } from '../trips/types';

/** A day with the names of its two ends. */
export interface DayDetail extends Day {
  startName: string | null;
  endName: string | null;
  /** Google's ids of the start and end places, when they were chosen from a search. */
  startPlaceId?: string | null;
  endPlaceId?: string | null;
}

export interface Stage {
  id: string;
  dayId: string;
  category: Category;
  stayOverrideMinutes: number | null;
  done: boolean;
  /** Place in the route (0 = first), or null before the day has been solved. */
  position: number | null;
  place: { id: string; googlePlaceId: string; name: string; lat: number; lng: number };
}
