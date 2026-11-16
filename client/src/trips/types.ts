import type { Airport } from '../airports/types';

export type TravelMode = 'walking' | 'driving' | 'transit';

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
  /** Where the trip starts and ends, when the person has said. */
  origin?: Airport | null;
  destination?: Airport | null;
}

export interface Day {
  id: string;
  tripId: string;
  /** The stay this day belongs to, or null/missing for a standalone day. */
  segmentId?: string | null;
  /** 'YYYY-MM-DD' */
  date: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  /** Minutes since midnight. */
  startTime: number;
  travelMode: TravelMode;
  stageCount: number;
}
