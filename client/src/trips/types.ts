import type { Airport } from '../airports/types';

export type TravelMode = 'walking' | 'driving';

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
  /** 'YYYY-MM-DD' */
  date: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  /** Minutes since midnight. */
  startTime: number;
  travelMode: TravelMode;
  stageCount: number;
}
