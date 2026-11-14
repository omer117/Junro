import { describe, expect, it } from 'vitest';
import { googleMapsDirectionsUrl } from './mapsLink';

const parse = (url: string) => new URL(url);

describe('googleMapsDirectionsUrl', () => {
  it('opens Google Maps directions from one point to another in the chosen travel mode', () => {
    const url = parse(
      googleMapsDirectionsUrl({
        from: { lat: 35.69, lng: 139.7 },
        to: { lat: 35.71, lng: 139.81 },
        mode: 'transit',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('35.69,139.7');
    expect(url.searchParams.get('destination')).toBe('35.71,139.81');
    expect(url.searchParams.get('travelmode')).toBe('transit');
  });

  it('names the places when their Google ids are known, so the map shows the place, not numbers', () => {
    const url = parse(
      googleMapsDirectionsUrl({
        from: { lat: 35.69, lng: 139.7, googlePlaceId: 'ChIJ-from' },
        to: { lat: 35.71, lng: 139.81, googlePlaceId: 'ChIJ-to' },
        mode: 'walking',
      }),
    );

    expect(url.searchParams.get('origin_place_id')).toBe('ChIJ-from');
    expect(url.searchParams.get('destination_place_id')).toBe('ChIJ-to');
    expect(url.searchParams.get('travelmode')).toBe('walking');
  });

  it('leaves the ids out for a point without one (the start of the day)', () => {
    const url = parse(
      googleMapsDirectionsUrl({
        from: { lat: 35.69, lng: 139.7 },
        to: { lat: 35.71, lng: 139.81, googlePlaceId: 'ChIJ-to' },
        mode: 'driving',
      }),
    );

    expect(url.searchParams.has('origin_place_id')).toBe(false);
    expect(url.searchParams.get('destination_place_id')).toBe('ChIJ-to');
  });
});
