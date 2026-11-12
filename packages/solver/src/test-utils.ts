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

/** Test helper: small seeded random generator (mulberry32), so tests never use Math.random. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Test helper: every ordering of the items. */
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}
