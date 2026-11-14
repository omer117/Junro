export interface DirectionsPoint {
  lat: number;
  lng: number;
  /** Google's id of the place, when we have one: the map then shows the place, not numbers. */
  googlePlaceId?: string;
}

/**
 * A link that opens Google Maps with directions between two points. It is only a link the person
 * presses: nothing is sent to Google from Junro, there is no key and no cost. It is how a leg by
 * public transport can be seen with real lines and times, also where Google's API has none.
 */
export function googleMapsDirectionsUrl(args: {
  from: DirectionsPoint;
  to: DirectionsPoint;
  mode: 'walking' | 'driving' | 'transit';
}): string {
  const { from, to, mode } = args;
  // Six decimals are about 10 cm; it also drops floating point noise such as 139.81070040000003.
  const coordinate = (n: number) => String(Number(n.toFixed(6)));
  const params = new URLSearchParams({
    api: '1',
    origin: `${coordinate(from.lat)},${coordinate(from.lng)}`,
    destination: `${coordinate(to.lat)},${coordinate(to.lng)}`,
    travelmode: mode,
  });
  if (from.googlePlaceId) params.set('origin_place_id', from.googlePlaceId);
  if (to.googlePlaceId) params.set('destination_place_id', to.googlePlaceId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
