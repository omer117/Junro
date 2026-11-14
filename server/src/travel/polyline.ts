import type { LatLng } from '@junro/solver';

/** Reads Google's encoded polyline: numbers stored in 5-bit chunks, as differences, 5 decimals. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

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

/** The reverse of decodePolyline. */
export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let lat = 0;
  let lng = 0;

  const writeNumber = (value: number) => {
    // Sign into the lowest bit, then 5 bits at a time, lowest first; 0x20 means "more follow".
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) {
      out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    out += String.fromCharCode(rest + 63);
  };

  for (const point of points) {
    const nextLat = Math.round(point.lat * 1e5);
    const nextLng = Math.round(point.lng * 1e5);
    writeNumber(nextLat - lat);
    writeNumber(nextLng - lng);
    lat = nextLat;
    lng = nextLng;
  }
  return out;
}

/**
 * Lines that follow each other, joined into one. Where one ends exactly where the next begins,
 * the meeting point is written once.
 */
export function joinPolylines(lines: string[]): string {
  const all: LatLng[] = [];
  for (const line of lines) {
    const points = decodePolyline(line);
    const last = all[all.length - 1];
    const first = points[0];
    if (last && first && last.lat === first.lat && last.lng === first.lng) points.shift();
    all.push(...points);
  }
  return encodePolyline(all);
}
