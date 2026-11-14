import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentPosition, LocationError } from './geolocation';

afterEach(() => vi.unstubAllGlobals());

const stubGeolocation = (behaviour: (ok: PositionCallback, fail: PositionErrorCallback) => void) =>
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: behaviour } });

describe('currentPosition', () => {
  it('answers with the latitude and longitude', async () => {
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 35.68, longitude: 139.76 } } as GeolocationPosition),
    );

    await expect(currentPosition()).resolves.toEqual({ lat: 35.68, lng: 139.76 });
  });

  it('says "denied" when the person refuses', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1 } as GeolocationPositionError));

    await expect(currentPosition()).rejects.toMatchObject({ reason: 'denied' });
  });

  it('says "unavailable" when the position cannot be found', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 2 } as GeolocationPositionError));

    await expect(currentPosition()).rejects.toBeInstanceOf(LocationError);
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('says "timeout" when nothing came back in time (for example the permission question was not answered)', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 3 } as GeolocationPositionError));

    await expect(currentPosition()).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('says "unsupported" when the browser has no geolocation', async () => {
    vi.stubGlobal('navigator', {});

    await expect(currentPosition()).rejects.toMatchObject({ reason: 'unsupported' });
  });
});
