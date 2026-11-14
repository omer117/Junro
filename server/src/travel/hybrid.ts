import type { LatLng, TravelTimeFn } from '@junro/solver';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routeMatrixCache } from '../db/schema.js';
import type { MapsClient } from '../google/types.js';
import { loadTravelTimes, readCachedTravelTimes } from './matrix.js';

/** Closer than this on foot (minutes) and public transport is not even asked about. */
export const WALK_ENOUGH_MINUTES = 10;

/** Old points are kept until the cache holds more than this. */
const MAX_STORED_POINTS = 40;

const pointKey = (p: LatLng): string => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** Timetables change through the day, so public transport times are kept per hour of the day. */
const slotOf = (departureTime: string): string => departureTime.slice(0, 13);

/** What is stored for public transport: only pairs we asked about; `null` = Google found no route. */
interface StoredTransit {
  slot: string;
  points: string[];
  entries: Array<[from: number, to: number, seconds: number | null]>;
}

export type LegMode = 'walk' | 'transit';

export interface HybridTimes {
  /** The shorter of walking and public transport, in minutes. */
  travelTime: TravelTimeFn;
  /** What the shorter one is. */
  legMode: (from: LatLng, to: LatLng) => LegMode;
}

/** Puts the two kinds of travel time together: for every pair, whichever is shorter. */
function combine(walk: TravelTimeFn, transit: Map<string, number>): HybridTimes {
  const ride = (from: LatLng, to: LatLng): number => {
    const seconds = transit.get(`${pointKey(from)}|${pointKey(to)}`);
    return seconds === undefined ? Infinity : seconds / 60;
  };
  return {
    travelTime: (from, to, departure) => Math.min(walk(from, to, departure), ride(from, to)),
    legMode: (from, to) => (ride(from, to) < walk(from, to, 0) ? 'transit' : 'walk'),
  };
}

/** One leg of a day: how it is travelled and how long it takes (rounded to whole minutes). */
export interface Leg {
  mode: LegMode;
  minutes: number;
}

/** The legs of a route (start, stops in order, end): for each, on foot or by public transport. */
export function legsOf(route: LatLng[], times: HybridTimes): Leg[] {
  return route.slice(0, -1).map((from, i) => {
    const to = route[i + 1]!;
    return { mode: times.legMode(from, to), minutes: Math.round(times.travelTime(from, to, 0)) };
  });
}

/**
 * Travel times for a day by public transport, where walking is used for what is close.
 *
 * 1. Walking times between all points (cached per day, cheap).
 * 2. For the pairs further apart than a short walk, public transport times, asked of Google one
 *    origin at a time, and stored per day and hour. Pairs that are close enough to walk are never
 *    asked about: that is both the cheaper way and the sensible one.
 * 3. Every pair gets the shorter of the two.
 *
 * Like walking and driving, what was paid for is stored after each request, and only new pairs
 * are asked for later.
 */
export async function loadHybridTimes(args: {
  db: Db;
  maps: MapsClient;
  dayId: string;
  points: LatLng[];
  /** The moment to leave (ISO timestamp), for the timetables. */
  departureTime: string;
  walkEnough?: number;
}): Promise<HybridTimes> {
  const { db, maps, dayId, departureTime } = args;
  const walkEnough = args.walkEnough ?? WALK_ENOUGH_MINUTES;
  const slot = slotOf(departureTime);

  const walk = await loadTravelTimes({ db, maps, dayId, mode: 'walking', points: args.points });
  const unique = uniquePoints(args.points);

  const seconds = new Map<string, number>();
  const stored = await loadTransit(db, dayId, slot, seconds);

  for (const from of unique) {
    const missing = unique.filter(
      (to) =>
        pointKey(to) !== pointKey(from) &&
        walk(from, to, 0) > walkEnough &&
        !seconds.has(`${pointKey(from)}|${pointKey(to)}`),
    );
    if (missing.length === 0) continue;

    const result = await maps.routeMatrix({
      origins: [from],
      destinations: missing,
      mode: 'transit',
      departureTime,
    });
    missing.forEach((to, j) => seconds.set(`${pointKey(from)}|${pointKey(to)}`, result[0]![j]!));
    await saveTransit(db, dayId, slot, seconds, stored, unique.map(pointKey));
  }

  return combine(walk, seconds);
}

/**
 * The same, from the cache only. Never calls Google. `null` means something needed is not known
 * yet (a new place, another hour), so the day needs a fresh solve.
 */
export async function readCachedHybridTimes(args: {
  db: Db;
  dayId: string;
  points: LatLng[];
  departureTime: string;
  walkEnough?: number;
}): Promise<HybridTimes | null> {
  const walkEnough = args.walkEnough ?? WALK_ENOUGH_MINUTES;
  const walk = await readCachedTravelTimes({
    db: args.db,
    dayId: args.dayId,
    mode: 'walking',
    points: args.points,
  });
  if (!walk) return null;

  const seconds = new Map<string, number>();
  await loadTransit(args.db, args.dayId, slotOf(args.departureTime), seconds);

  const unique = uniquePoints(args.points);
  for (const from of unique) {
    for (const to of unique) {
      if (pointKey(from) === pointKey(to) || walk(from, to, 0) <= walkEnough) continue;
      if (!seconds.has(`${pointKey(from)}|${pointKey(to)}`)) return null;
    }
  }
  return combine(walk, seconds);
}

function uniquePoints(points: LatLng[]): LatLng[] {
  const seen = new Map<string, LatLng>();
  for (const point of points) if (!seen.has(pointKey(point))) seen.set(pointKey(point), point);
  return [...seen.values()];
}

/** Fills `into` with what is stored for this hour. Another hour's times are not used. */
async function loadTransit(
  db: Db,
  dayId: string,
  slot: string,
  into: Map<string, number>,
): Promise<string[]> {
  const [row] = await db
    .select()
    .from(routeMatrixCache)
    .where(and(eq(routeMatrixCache.dayId, dayId), eq(routeMatrixCache.travelMode, 'transit')));
  if (!row) return [];
  const stored = row.matrix as StoredTransit;
  if (stored.slot !== slot) return [];
  for (const [from, to, value] of stored.entries) {
    into.set(`${stored.points[from]}|${stored.points[to]}`, value ?? Infinity);
  }
  return stored.points;
}

async function saveTransit(
  db: Db,
  dayId: string,
  slot: string,
  seconds: Map<string, number>,
  previousPoints: string[],
  neededKeys: string[],
): Promise<void> {
  let points = [...new Set([...neededKeys, ...previousPoints])];
  if (points.length > MAX_STORED_POINTS) points = points.slice(0, MAX_STORED_POINTS);
  const index = new Map(points.map((key, i) => [key, i]));

  const entries: StoredTransit['entries'] = [];
  for (const [pair, value] of seconds) {
    const [from, to] = pair.split('|') as [string, string];
    const i = index.get(from);
    const j = index.get(to);
    if (i !== undefined && j !== undefined) {
      entries.push([i, j, Number.isFinite(value) ? value : null]);
    }
  }

  const matrix: StoredTransit = { slot, points, entries };
  await db
    .insert(routeMatrixCache)
    .values({ dayId, travelMode: 'transit', inputHash: slot, matrix })
    .onConflictDoUpdate({
      target: [routeMatrixCache.dayId, routeMatrixCache.travelMode],
      set: { inputHash: slot, matrix },
    });
}
