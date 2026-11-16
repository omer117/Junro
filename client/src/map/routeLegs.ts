import type { RouteLeg } from './engine';
import { decodePolyline, splitAtStops, type LatLng } from './polyline';

/**
 * The route as separate legs, each with the way it is travelled, ready for the map to draw in a
 * style per mode. No server change and no Google call: the one encoded line the server already
 * sends is cut at the stops (see splitAtStops).
 *
 * `modes` has one entry per leg: the mode of each leg on a public transport day (walk or transit),
 * the day's own mode on any other day. If the line cannot be cut it is drawn whole, as one leg
 * with the first mode, which is the same picture as before.
 */
export function buildRouteLegs(args: {
  /** The encoded line from the server. */
  line: string | null;
  /** Start, every stop in route order, end. */
  points: LatLng[];
  modes: RouteLeg['mode'][];
  /** How many legs from the start are already behind the person. */
  travelledLegs?: number;
}): RouteLeg[] | null {
  if (!args.line) return null;
  const path = decodePolyline(args.line);
  if (path.length < 2) return null;

  const pieces = splitAtStops(path, args.points);
  if (!pieces) {
    return [{ path, mode: args.modes[0] ?? 'walk', travelled: false }];
  }
  const travelled = args.travelledLegs ?? 0;
  return pieces.map((piece, index) => ({
    path: piece,
    mode: args.modes[index] ?? args.modes[0] ?? 'walk',
    travelled: index < travelled,
  }));
}
