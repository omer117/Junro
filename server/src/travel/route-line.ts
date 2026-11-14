import { createHash } from 'node:crypto';
import type { LatLng } from '@junro/solver';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { days, type RouteLine, type TravelMode } from '../db/schema.js';
import type { MapsClient } from '../google/types.js';
import type { LegMode } from './hybrid.js';
import { joinPolylines } from './polyline.js';

const key = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/**
 * A day remembers the lines of its latest routes (walking and driving, before and after an edit),
 * and for public transport also the line of each leg, so they can be reused.
 */
const MAX_LINES_PER_DAY = 60;

/**
 * What a stored line was made for: the mode and the stops in order. A different route has a
 * different one.
 */
function routeFingerprint(mode: string, route: LatLng[]): string {
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

/** Timetables change through the day, so public transport lines are kept per hour. */
const hourOf = (departureTime: string): string => departureTime.slice(0, 13);

/** What the line of the whole public transport route was made for. */
const transitFingerprint = (route: LatLng[], departureTime: string): string =>
  routeFingerprint(`transit@${hourOf(departureTime)}`, route);

/** What the line of one leg was made for: how it is travelled, when, and from where to where. */
const legFingerprint = (from: LatLng, to: LatLng, how: LegMode, departureTime: string): string =>
  routeFingerprint(`leg:${how}@${how === 'transit' ? hourOf(departureTime) : '-'}`, [from, to]);

/** The stored line for exactly this public transport route, or null. Never calls Google. */
export async function readTransitRouteLine(args: {
  db: Db;
  dayId: string;
  route: LatLng[];
  departureTime: string;
}): Promise<string | null> {
  const lines = await storedLines(args.db, args.dayId);
  const fingerprint = transitFingerprint(args.route, args.departureTime);
  return lines.find((entry) => entry.fingerprint === fingerprint)?.line ?? null;
}

/**
 * The line for a public transport route. Google cannot draw a public transport route through
 * stops in between, so each leg is drawn on its own (on foot or by public transport) and the legs
 * are joined into one line. Each leg is stored, so changing one stop only draws the legs that
 * changed. What was drawn is saved after every leg: a failure halfway loses nothing that was
 * already paid for.
 *
 * `legModes[i]` says how the leg from `route[i]` to `route[i + 1]` is travelled.
 */
export async function loadTransitRouteLine(args: {
  db: Db;
  maps: MapsClient;
  dayId: string;
  route: LatLng[];
  legModes: LegMode[];
  departureTime: string;
}): Promise<string | null> {
  const { db, maps, dayId, route, legModes, departureTime } = args;
  if (route.length < 2) return null;
  if (route.length === 2 && key(route[0]!) === key(route[1]!)) return null;

  const whole = transitFingerprint(route, departureTime);
  let lines = await storedLines(db, dayId);
  const known = lines.find((entry) => entry.fingerprint === whole);
  if (known) return known.line;

  const legs: string[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i]!;
    const to = route[i + 1]!;
    if (key(from) === key(to)) continue; // nothing to travel

    const how = legModes[i] ?? 'walk';
    const fingerprint = legFingerprint(from, to, how, departureTime);
    let line = lines.find((entry) => entry.fingerprint === fingerprint)?.line;
    if (!line) {
      line = await maps.computeRoute({
        origin: from,
        destination: to,
        intermediates: [],
        mode: how === 'transit' ? 'transit' : 'walking',
        ...(how === 'transit' ? { departureTime } : {}),
      });
      lines = [...lines, { fingerprint, line }].slice(-MAX_LINES_PER_DAY);
      await db.update(days).set({ routeLines: lines }).where(eq(days.id, dayId));
    }
    legs.push(line);
  }

  const joined = joinPolylines(legs);
  lines = [...lines, { fingerprint: whole, line: joined }].slice(-MAX_LINES_PER_DAY);
  await db.update(days).set({ routeLines: lines }).where(eq(days.id, dayId));
  return joined;
}
