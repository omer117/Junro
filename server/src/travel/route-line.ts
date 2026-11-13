import { createHash } from 'node:crypto';
import type { LatLng } from '@junro/solver';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { days, type TravelMode } from '../db/schema.js';
import type { MapsClient } from '../google/types.js';

const key = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** What a stored line was made for: the mode and the stops in order. A different route has a different one. */
function routeFingerprint(mode: TravelMode, route: LatLng[]): string {
  return createHash('sha256')
    .update(`${mode}|${route.map(key).join('>')}`)
    .digest('hex');
}

/** The stored line for exactly this route, or null. Never calls Google. */
export async function readRouteLine(args: {
  db: Db;
  dayId: string;
  mode: TravelMode;
  route: LatLng[];
}): Promise<string | null> {
  const [day] = await args.db
    .select({ polyline: days.polyline, polylineKey: days.polylineKey })
    .from(days)
    .where(eq(days.id, args.dayId));
  return day?.polyline && day.polylineKey === routeFingerprint(args.mode, args.route)
    ? day.polyline
    : null;
}

/**
 * The line to draw on the map for a finished route. One Google call, and only when the
 * route is not the one we already drew: the line is stored on the day, together with a
 * fingerprint of the mode and the stops in order.
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

  const [day] = await db
    .select({ polyline: days.polyline, polylineKey: days.polylineKey })
    .from(days)
    .where(eq(days.id, dayId));
  if (day?.polyline && day.polylineKey === fingerprint) return day.polyline;

  // If Google fails this throws before anything is written, so the previous line is kept.
  const line = await maps.computeRoute({
    origin: route[0]!,
    destination: route[route.length - 1]!,
    intermediates: route.slice(1, -1),
    mode,
  });
  await db.update(days).set({ polyline: line, polylineKey: fingerprint }).where(eq(days.id, dayId));
  return line;
}
