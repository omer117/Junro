export interface LatLng {
  lat: number;
  lng: number;
}

/** Decodes Google's encoded polyline (the string the server sends as `routeLine`). */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  // Each number is stored in 5-bit chunks, lowest chunk first; a set 6th bit means "more follow".
  const readNumber = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    // The lowest bit is the sign.
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readNumber();
    lng += readNumber();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Distance in metres between two points (haversine). Good enough for drawing. */
function distance(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The first `fraction` (0..1) of a path, measured along its length. Used to draw the route
 * line growing across the map.
 */
export function partialPath(path: LatLng[], fraction: number): LatLng[] {
  if (path.length <= 1) return [...path];
  const f = Math.min(1, Math.max(0, fraction));
  if (f >= 1) return [...path];

  const lengths = path.slice(1).map((point, i) => distance(path[i]!, point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return [...path];

  let remaining = f * total;
  const result: LatLng[] = [path[0]!];
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining >= length) {
      result.push(path[i + 1]!);
      remaining -= length;
    } else {
      const t = length === 0 ? 0 : remaining / length;
      const from = path[i]!;
      const to = path[i + 1]!;
      if (t > 0)
        result.push({
          lat: from.lat + (to.lat - from.lat) * t,
          lng: from.lng + (to.lng - from.lng) * t,
        });
      break;
    }
  }
  return result;
}

/** A stop farther than this from the route line means the line does not really pass it. */
const MAX_STOP_DISTANCE_METRES = 150;

/**
 * Cuts the route line into one piece per leg (start to first stop, stop to stop, last stop to
 * end), so each leg can be drawn in its own style.
 *
 * For each stop it takes the line vertex nearest to it, looking only FORWARD from the previous
 * cut: a route can pass close to a later stop early on (out to the far end and back), and cutting
 * there would put the pieces in the wrong order. Two neighbouring pieces share their cut vertex,
 * so the drawn line stays joined.
 *
 * Returns null when the line cannot be cut sensibly (fewer than two stops, or a stop more than
 * 150 m from the line); the caller then draws the line whole.
 */
export function splitAtStops(path: LatLng[], stops: LatLng[]): LatLng[][] | null {
  if (path.length < 2 || stops.length < 2) return null;

  const cuts: number[] = [];
  let from = 0;
  for (const stop of stops) {
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let i = from; i < path.length; i++) {
      const d = distance(path[i]!, stop);
      if (d < nearestDistance) {
        nearest = i;
        nearestDistance = d;
      }
    }
    if (nearest < 0 || nearestDistance > MAX_STOP_DISTANCE_METRES) return null;
    cuts.push(nearest);
    from = nearest;
  }

  return cuts.slice(0, -1).map((cut, i) => {
    const end = cuts[i + 1]!;
    return end > cut ? path.slice(cut, end + 1) : [path[cut]!, path[cut]!];
  });
}
