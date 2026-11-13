import { useState } from 'react';
import type { MapMarker } from './engine';
import { MapView } from './MapView';

/**
 * A development page (only available in `npm run dev`) to look at the map and its markers
 * while building. The places are sample points around Tokyo Station, not real user data.
 */
const SAMPLE: MapMarker[] = [
  { id: 'start', kind: 'start', position: { lat: 35.6812, lng: 139.7671 }, label: 'Start · 9:00' },
  {
    id: 'a',
    kind: 'stage',
    position: { lat: 35.7148, lng: 139.7967 },
    name: 'Senso-ji',
    category: 'temple',
  },
  {
    id: 'b',
    kind: 'stage',
    position: { lat: 35.7101, lng: 139.8107 },
    name: 'Tokyo Skytree',
    category: 'viewpoint',
  },
  {
    id: 'c',
    kind: 'stage',
    position: { lat: 35.7188, lng: 139.7765 },
    name: 'Ueno ramen',
    category: 'restaurant',
  },
  {
    id: 'd',
    kind: 'stage',
    position: { lat: 35.7141, lng: 139.7774 },
    name: 'Ueno museum',
    category: 'museum',
  },
  { id: 'end', kind: 'end', position: { lat: 35.6812, lng: 139.7671 }, label: 'End · hotel' },
];

export function MapDemo() {
  const [numbered, setNumbered] = useState(false);
  const markers = SAMPLE.map((marker, index) =>
    numbered && marker.kind === 'stage'
      ? { ...marker, number: index, ...(marker.id === 'c' ? { warning: true } : {}) }
      : marker,
  );

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <MapView markers={markers} padding={{ top: 90, right: 40, bottom: 90, left: 40 }} />
      <button
        type="button"
        onClick={() => setNumbered((value) => !value)}
        style={{ position: 'absolute', top: 16, left: 16 }}
      >
        {numbered ? 'Show category icons' : 'Show route numbers'}
      </button>
    </div>
  );
}
