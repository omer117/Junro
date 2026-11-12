import type { LatLng, Stage, TimeWindow, TravelTimeFn } from './types.js';

/** Test helper: a point on a line. Position `x` is also the distance in minutes. */
export const loc = (x: number): LatLng => ({ lat: 0, lng: x });

/** Test helper: travel time equals the distance on the line. */
export const lineTravel: TravelTimeFn = (from, to) => Math.abs(from.lng - to.lng);

export function stageAt(id: string, x: number, stayMinutes: number, window?: TimeWindow): Stage {
  return window
    ? { id, location: loc(x), stayMinutes, window }
    : { id, location: loc(x), stayMinutes };
}
