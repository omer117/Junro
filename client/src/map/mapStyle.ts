/** The map colours. They match the --map-* tokens in styles/tokens.css (a test checks it). */
export const MAP_COLOURS = {
  land: '#e4e8f0',
  road: '#ffffff',
  park: '#cfe5d4',
  water: '#bfd5e8',
} as const;

interface StyleRule {
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string | number>>;
}

/**
 * Google Maps JSON style for "Golden hour": pale land, white roads, soft green parks and blue
 * water, and nothing else competing with the stops the user picked. This is a classic JSON
 * style, so it needs no Map ID or extra setup in the Cloud console.
 */
export const mapStyle: StyleRule[] = [
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#55526f' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: MAP_COLOURS.land }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: MAP_COLOURS.land }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: MAP_COLOURS.road }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: MAP_COLOURS.park }] },
  { featureType: 'poi.business', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: MAP_COLOURS.water }] },
];
