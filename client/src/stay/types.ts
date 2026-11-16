import type { DayDetail } from '../day/types';
import type { TravelMode } from '../trips/types';
import type { RouteResult } from '../route/types';

/** One stay: the days a trip spends in one city, with one hotel. */
export interface Stay {
  id: string;
  tripId: string;
  name: string;
  hotel: { lat: number; lng: number };
  hotelName: string | null;
  travelMode: TravelMode;
  startTime: number;
  endTime: number | null;
  /** 'YYYY-MM-DD' of the first day. */
  firstDate: string | null;
  dayCount: number;
  placeCount: number;
}

export interface StayDetail extends Stay {
  days: DayDetail[];
}

export interface ProposedDay {
  dayId: string;
  /** Stage ids in the proposed visiting order. */
  order: string[];
  visits: RouteResult['visits'];
  endArrival: number;
  violations: RouteResult['violations'];
  dropped: string[];
}

export interface Proposal {
  days: ProposedDay[];
  leftOut: Array<{ id: string; reason: 'did_not_fit' | 'closed_all_days' }>;
  frozenDayIds: string[];
  score: { lateness: number; droppedOptional: number; travel: number; imbalance: number };
  moved: Array<{ stageId: string; fromDayId: string }>;
  inputHash: string;
  /** The times are guesses from distances, not from Google. */
  estimated: true;
}

export interface NewStay {
  name: string;
  firstDate: string;
  dayCount: number;
  hotel: { lat: number; lng: number };
  hotelName?: string;
  hotelPlaceId?: string;
  travelMode: TravelMode;
  startTime: number;
  endTime?: number;
}
