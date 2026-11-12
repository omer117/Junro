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
