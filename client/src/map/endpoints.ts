import type { LatLng, MapMarker } from './engine';

/** About a metre, in degrees. Closer than this is the same place on a map. */
const SAME_SPOT = 0.00001;

/** True when two points are the same place on a map (within about a metre). */
export const isSamePlace = (a: LatLng, b: LatLng) =>
  Math.abs(a.lat - b.lat) < SAME_SPOT && Math.abs(a.lng - b.lng) < SAME_SPOT;

const sameSpot = (a: MapMarker, b: MapMarker) => isSamePlace(a.position, b.position);

/**
 * A day that starts and ends at the same place (the hotel) would draw two pins on top of each
 * other, and the second would hide the first. This joins them into one marker with both labels.
 */
export function mergeEndpoints(markers: MapMarker[]): MapMarker[] {
  const start = markers.find((m) => m.kind === 'start');
  const end = markers.find((m) => m.kind === 'end');
  if (!start || !end || !sameSpot(start, end)) return markers;

  const joined: MapMarker = {
    id: 'start-end',
    kind: 'loop',
    position: start.position,
    ...(start.label !== undefined ? { label: start.label } : {}),
    ...(end.label !== undefined ? { endLabel: end.label } : {}),
  };
  // The joined marker takes the place of the start; the end is removed.
  return markers.flatMap((m) => (m === start ? [joined] : m === end ? [] : [m]));
}
