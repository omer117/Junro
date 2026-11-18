import { describe, expect, it } from 'vitest';
import { buildRouteLegs } from '../routeLegs';
import { splitAtStops, type LatLng } from '../polyline';

// A line along the equator, a vertex every 0.001 degrees (about 111 m).
const at = (index: number): LatLng => ({ lat: 0, lng: index * 0.001 });
const lineOf = (indexes: number[]) => indexes.map(at);

describe('splitAtStops', () => {
  it('cuts a straight line at its stops, sharing the cut vertex between two pieces', () => {
    const path = lineOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const pieces = splitAtStops(path, [at(0), at(4), at(10)]);

    expect(pieces).toEqual([lineOf([0, 1, 2, 3, 4]), lineOf([4, 5, 6, 7, 8, 9, 10])]);
  });

  it('gives n - 1 pieces for n stops', () => {
    const path = lineOf([0, 1, 2, 3, 4, 5, 6]);

    expect(splitAtStops(path, [at(0), at(2), at(4), at(6)])).toHaveLength(3);
  });

  it('handles a day that ends where it started (start = end)', () => {
    // Out to 5 and back to 0.
    const path = lineOf([0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0]);

    const pieces = splitAtStops(path, [at(0), at(5), at(0)]);

    expect(pieces).toEqual([lineOf([0, 1, 2, 3, 4, 5]), lineOf([5, 4, 3, 2, 1, 0])]);
  });

  it('searches forward only: a line that passes near a later stop early is not cut there', () => {
    // The line goes out to 9 first and comes back to 3 at the end. Stop B (at 3) is passed early
    // at vertex 3, but the route reaches it only at the end.
    const path = lineOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3]);

    const pieces = splitAtStops(path, [at(0), at(9), at(3)]);

    expect(pieces).toEqual([lineOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), lineOf([9, 8, 7, 6, 5, 4, 3])]);
  });

  it('answers null when a stop is more than 150 m from the line (the line is then drawn whole)', () => {
    const path = lineOf([0, 1, 2, 3, 4, 5]);
    const farAway = { lat: 0.01, lng: 0.003 }; // about 1.1 km off

    expect(splitAtStops(path, [at(0), farAway, at(5)])).toBeNull();
  });

  it('accepts a stop a little off the line (a place beside the road)', () => {
    const path = lineOf([0, 1, 2, 3, 4, 5]);
    const beside = { lat: 0.0005, lng: 0.003 }; // about 55 m

    expect(splitAtStops(path, [at(0), beside, at(5)])).toHaveLength(2);
  });

  it('answers null when there is nothing to cut', () => {
    expect(splitAtStops([at(0)], [at(0), at(1)])).toBeNull();
    expect(splitAtStops(lineOf([0, 1, 2]), [at(0)])).toBeNull();
  });
});

describe('buildRouteLegs', () => {
  const line = lineOf([0, 1, 2, 3, 4, 5, 6]);
  // A real encoded polyline is needed by the builder; encode the same points here.
  const encode = (points: LatLng[]) => {
    let lat = 0;
    let lng = 0;
    let out = '';
    const put = (value: number) => {
      let v = value < 0 ? ~(value << 1) : value << 1;
      while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      out += String.fromCharCode(v + 63);
    };
    for (const p of points) {
      const la = Math.round(p.lat * 1e5);
      const ln = Math.round(p.lng * 1e5);
      put(la - lat);
      put(ln - lng);
      lat = la;
      lng = ln;
    }
    return out;
  };
  const encoded = encode(line);
  const stops = [at(0), at(3), at(6)];

  it('gives every leg the mode of the day on a walking or driving day', () => {
    const legs = buildRouteLegs({ line: encoded, points: stops, modes: ['walk', 'walk'] })!;

    expect(legs.map((l) => l.mode)).toEqual(['walk', 'walk']);
    expect(legs).toHaveLength(2);
    expect(legs[0]!.path.length).toBeGreaterThanOrEqual(2);
  });

  it('uses the mode of each leg on a public transport day', () => {
    const legs = buildRouteLegs({ line: encoded, points: stops, modes: ['walk', 'transit'] })!;

    expect(legs.map((l) => l.mode)).toEqual(['walk', 'transit']);
  });

  it('marks the first legs as travelled', () => {
    const legs = buildRouteLegs({
      line: encoded,
      points: stops,
      modes: ['drive', 'drive'],
      travelledLegs: 1,
    })!;

    expect(legs.map((l) => l.travelled)).toEqual([true, false]);
  });

  it('falls back to one leg with the whole line when it cannot be cut', () => {
    const farStops = [at(0), { lat: 0.5, lng: 0.5 }, at(6)];

    const legs = buildRouteLegs({ line: encoded, points: farStops, modes: ['walk', 'walk'] })!;

    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ mode: 'walk', travelled: false });
    expect(legs[0]!.path).toHaveLength(line.length);
  });

  it('answers null when there is no line', () => {
    expect(buildRouteLegs({ line: null, points: stops, modes: ['walk', 'walk'] })).toBeNull();
    expect(buildRouteLegs({ line: '', points: stops, modes: ['walk', 'walk'] })).toBeNull();
  });
});
