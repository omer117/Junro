import { createHash } from 'node:crypto';
import type { LatLng, TravelTimeFn } from '@junro/solver';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routeMatrixCache, type TravelMode } from '../db/schema.js';
import type { MapsClient } from '../google/types.js';

/** One Google request takes at most 25 origins and 25 destinations. */
export const MAX_MATRIX_POINTS = 25;

/** Old points are kept (a removed stage may come back) until the cache holds more than this. */
const MAX_STORED_POINTS = 40;

/** Two coordinates within about a metre are the same place. */
const pointKey = (p: LatLng): string => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/**
 * What is stored in route_matrix_cache.matrix. Only pairs we have paid for are listed;
 * `null` means Google said there is no route. Seconds, as Google reports them.
 */
interface StoredMatrix {
  points: string[];
  entries: Array<[origin: number, destination: number, seconds: number | null]>;
}

/**
 * Gives the solver a synchronous travel-time function for one day, paying Google as little
 * as possible.
 *
 * The solver cannot wait for network calls, so all travel times between the day's points
 * are fetched up front and the returned function just looks them up.
 *
 * Money rules:
 * - Every pair is stored per day and travel mode. The same points never cost twice.
 * - Adding one stage asks only for its new row and column, not the whole matrix.
 * - Removing a stage or reordering asks for nothing.
 * - After each Google request the result is saved, so a failure halfway loses nothing that
 *   was already paid for.
 */
export async function loadTravelTimes(args: {
  db: Db;
  maps: MapsClient;
  dayId: string;
  mode: TravelMode;
  /** Start, every stage, and end. Duplicates (start = end) are merged. */
  points: LatLng[];
}): Promise<TravelTimeFn> {
  const { db, maps, dayId, mode } = args;

  const needed = new Map<string, LatLng>();
  for (const point of args.points) {
    if (!needed.has(pointKey(point))) needed.set(pointKey(point), point);
  }
  if (needed.size > MAX_MATRIX_POINTS) {
    throw new RangeError(`Too many points: ${needed.size} (the maximum is ${MAX_MATRIX_POINTS})`);
  }
  const neededKeys = [...needed.keys()];
  // One point (start = end, no stages) has nothing to travel between.
  if (neededKeys.length < 2) return () => 0;

  // seconds.get("a|b") is a number (known), Infinity (no route), or undefined (never asked).
  const seconds = new Map<string, number>();
  const storedPoints = await load(db, dayId, mode, seconds);

  const known = (from: string, to: string) => from === to || seconds.has(`${from}|${to}`);

  // Origins we know nothing about get a full row; the rest only miss the destinations that are new.
  const emptyOrigins = neededKeys.filter(
    (from) => !neededKeys.some((to) => to !== from && known(from, to)),
  );
  const requests: Array<{ origins: string[]; destinations: string[] }> = [];
  if (emptyOrigins.length > 0) requests.push({ origins: emptyOrigins, destinations: neededKeys });

  // Everyone else: group origins that miss exactly the same destinations into one request.
  const groups = new Map<string, { origins: string[]; destinations: string[] }>();
  for (const from of neededKeys) {
    if (emptyOrigins.includes(from)) continue;
    const missing = neededKeys.filter((to) => !known(from, to));
    if (missing.length === 0) continue;
    const id = missing.join(';');
    const group = groups.get(id) ?? { origins: [], destinations: missing };
    group.origins.push(from);
    groups.set(id, group);
  }
  requests.push(...groups.values());

  for (const request of requests) {
    const result = await maps.routeMatrix({
      origins: request.origins.map((key) => needed.get(key)!),
      destinations: request.destinations.map((key) => needed.get(key)!),
      mode,
    });
    request.origins.forEach((from, i) =>
      request.destinations.forEach((to, j) => {
        if (from !== to) seconds.set(`${from}|${to}`, result[i]![j]!);
      }),
    );
    await save(db, dayId, mode, seconds, storedPoints, neededKeys);
  }

  return lookup(seconds);
}

/** A travel-time function that reads from the pairs we hold. Unknown pairs are Infinity, never a guess. */
function lookup(seconds: Map<string, number>): TravelTimeFn {
  return (from, to) => {
    const a = pointKey(from);
    const b = pointKey(to);
    if (a === b) return 0;
    const value = seconds.get(`${a}|${b}`);
    return value === undefined ? Infinity : value / 60;
  };
}

/**
 * The same travel times as loadTravelTimes, but from the cache only: it never calls Google.
 * Returns null when any pair is missing (a stop was added, the travel mode changed...), meaning
 * "this needs a fresh solve".
 */
export async function readCachedTravelTimes(args: {
  db: Db;
  dayId: string;
  mode: TravelMode;
  points: LatLng[];
}): Promise<TravelTimeFn | null> {
  const keys = [...new Set(args.points.map(pointKey))];
  if (keys.length < 2) return () => 0;

  const seconds = new Map<string, number>();
  await load(args.db, args.dayId, args.mode, seconds);
  for (const from of keys) {
    for (const to of keys) {
      if (from !== to && !seconds.has(`${from}|${to}`)) return null;
    }
  }
  return lookup(seconds);
}

async function load(
  db: Db,
  dayId: string,
  mode: TravelMode,
  into: Map<string, number>,
): Promise<string[]> {
  const [row] = await db
    .select()
    .from(routeMatrixCache)
    .where(and(eq(routeMatrixCache.dayId, dayId), eq(routeMatrixCache.travelMode, mode)));
  if (!row) return [];

  const stored = row.matrix as StoredMatrix;
  for (const [from, to, value] of stored.entries) {
    into.set(`${stored.points[from]}|${stored.points[to]}`, value ?? Infinity);
  }
  return stored.points;
}

async function save(
  db: Db,
  dayId: string,
  mode: TravelMode,
  seconds: Map<string, number>,
  previousPoints: string[],
  neededKeys: string[],
): Promise<void> {
  // Keep every point we know, plus the ones needed now. Past the limit, forget the old ones.
  let points = [...new Set([...neededKeys, ...previousPoints])];
  if (points.length > MAX_STORED_POINTS) points = points.slice(0, MAX_STORED_POINTS);
  const index = new Map(points.map((key, i) => [key, i]));

  const entries: StoredMatrix['entries'] = [];
  for (const [pair, value] of seconds) {
    const [from, to] = pair.split('|') as [string, string];
    const i = index.get(from);
    const j = index.get(to);
    if (i !== undefined && j !== undefined) {
      entries.push([i, j, Number.isFinite(value) ? value : null]);
    }
  }

  const matrix: StoredMatrix = { points, entries };
  const inputHash = createHash('sha256').update(points.slice().sort().join(';')).digest('hex');
  await db
    .insert(routeMatrixCache)
    .values({ dayId, travelMode: mode, inputHash, matrix })
    .onConflictDoUpdate({
      target: [routeMatrixCache.dayId, routeMatrixCache.travelMode],
      set: { inputHash, matrix },
    });
}
