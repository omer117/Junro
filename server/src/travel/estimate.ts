import type { LatLng, TravelTimeFn } from '@junro/solver';
import type { TravelMode } from '../db/schema.js';

const EARTH_KM = 6371;

/** Straight-line distance in kilometres (haversine). */
function kilometres(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Travel time guessed from the distance alone, with no Google call. The split of a stay only needs
 * to know which places are close to each other, not exact minutes; the real times come later,
 * when a day is planned, and the same estimate is used for every pair so it is fair.
 *
 * A winding street is longer than the straight line, so each mode multiplies the distance by a
 * detour factor, then divides by a typical speed.
 */
export function estimateTravelTime(mode: TravelMode): TravelTimeFn {
  const walk = (km: number) => ((km * 1.3) / 4.5) * 60;
  const drive = (km: number) => (km === 0 ? 0 : ((km * 1.4) / 25) * 60 + 5);
  // Public transport: a wait and a walk to the stop, then riding at about 20 km/h on a bent line.
  const transit = (km: number) => Math.min(walk(km), km === 0 ? 0 : 10 + ((km * 1.4) / 20) * 60);

  return (from, to) => {
    const km = kilometres(from, to);
    if (mode === 'driving') return drive(km);
    if (mode === 'transit') return transit(km);
    return walk(km);
  };
}
