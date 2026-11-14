import type { LatLng } from '../map/engine';

export type LocationProblem = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export class LocationError extends Error {
  constructor(readonly reason: LocationProblem) {
    super(`Location problem: ${reason}`);
  }
}

/**
 * Where the person is right now, once. The browser asks them for permission the first time.
 * The result is never stored: it is sent to the server only to plan the rest of the day.
 */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      // Error code 1 is PERMISSION_DENIED, 2 is POSITION_UNAVAILABLE and 3 is TIMEOUT.
      (error) =>
        reject(
          new LocationError(
            error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}
