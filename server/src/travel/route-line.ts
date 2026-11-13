import { createHash } from 'node:crypto';
import type { LatLng } from '@junro/solver';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { days, type RouteLine, type TravelMode } from '../db/schema.js';
import type { MapsClient } from '../google/types.js';

const key = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** A day remembers the lines of its latest routes (walking and driving, before and after an edit). */
const MAX_LINES_PER_DAY = 8;

/**
 * What a stored line was made for: the mode and the stops in order. A different route has a
 * different one.
 */
function routeFingerprint(mode: TravelMode, route: LatLng[]): string {
  return createHash('sha256')
    .update(`${mode}|${route.map(key).join('>')}`)
    .digest('hex');
}

async function storedLines(db: Db, dayId: string): Promise<RouteLine[]> {
  const [day] = await db
    .select({ routeLines: days.routeLines })
    .from(days)
    .where(eq(days.id, dayId));
  return day?.routeLines ?? [];
}

/** The stored line for exactly this route, or null. Never calls Google. */
export async function readRouteLine(args: {
  db: Db;
  dayId: string;
  mode: TravelMode;
  route: LatLng[];
}): Promise<string | null> {
  const lines = await storedLines(args.db, args.dayId);
  const fingerprint = routeFingerprint(args.mode, args.route);
  return lines.find((entry) => entry.fingerprint === fingerprint)?.line ?? null;
}

/**
 * The line to draw on the map for a finished route. One Google call, and only when this exact
 * route has no line yet. Lines are kept per route (a fingerprint of the mode and the stops in
 * order), so going back from driving to walking, or undoing an edit, finds the old line and
 * costs nothing.
 *
 * `route` is the whole trip in order: start, every stage, end. Returns null when there is
 * nothing to travel (no stages and start = end).
 */
export async function loadRouteLine(args: {
  db: Db;
  maps: MapsClient;
  dayId: string;
  mode: TravelMode;
  route: LatLng[];
}): Promise<string | null> {
  const { db, maps, dayId, mode, route } = args;
  if (route.length < 2) return null;
  if (route.length === 2 && key(route[0]!) === key(route[1]!)) return null;

  const fingerprint = routeFingerprint(mode, route);
  const lines = await storedLines(db, dayId);
  const known = lines.find((entry) => entry.fingerprint === fingerprint);
  if (known) return known.line;

  // If Google fails this throws before anything is written, so the earlier lines are kept.
  const line = await maps.computeRoute({
    origin: route[0]!,
    destination: route[route.length - 1]!,
    intermediates: route.slice(1, -1),
    mode,
  });

  // Newest last; past the limit the oldest go.
  const kept = [...lines, { fingerprint, line }].slice(-MAX_LINES_PER_DAY);
  await db.update(days).set({ routeLines: kept }).where(eq(days.id, dayId));
  return line;
}
