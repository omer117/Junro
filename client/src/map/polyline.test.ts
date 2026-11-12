import { describe, expect, it } from 'vitest';
import { decodePolyline, partialPath } from './polyline';

describe('decodePolyline', () => {
  it("decodes Google's documented example", () => {
    // From the Encoded Polyline Algorithm Format documentation.
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');

    expect(points).toHaveLength(3);
    expect(points[0]!.lat).toBeCloseTo(38.5, 5);
    expect(points[0]!.lng).toBeCloseTo(-120.2, 5);
    expect(points[1]!.lat).toBeCloseTo(40.7, 5);
    expect(points[1]!.lng).toBeCloseTo(-120.95, 5);
    expect(points[2]!.lat).toBeCloseTo(43.252, 5);
    expect(points[2]!.lng).toBeCloseTo(-126.453, 5);
  });

  it('gives no points for an empty line', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('partialPath', () => {
  // Three points along a line of longitude, 1 degree apart each.
  const path = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 0, lng: 2 },
  ];

  it('is just the first point at 0 and the whole path at 1', () => {
    expect(partialPath(path, 0)).toEqual([path[0]]);
    expect(partialPath(path, 1)).toEqual(path);
  });

  it('stops part-way along a segment', () => {
    const half = partialPath(path, 0.25); // a quarter of 2 degrees = 0.5 degrees

    expect(half).toHaveLength(2);
    expect(half[0]).toEqual(path[0]);
    expect(half[1]!.lng).toBeCloseTo(0.5, 3);
  });

  it('keeps every point it has passed', () => {
    const most = partialPath(path, 0.75); // 1.5 degrees

    expect(most).toHaveLength(3);
    expect(most[1]).toEqual(path[1]);
    expect(most[2]!.lng).toBeCloseTo(1.5, 3);
  });

  it('copes with a path of one point, no points, or no length', () => {
    expect(partialPath([], 0.5)).toEqual([]);
    expect(partialPath([path[0]!], 0.5)).toEqual([path[0]]);
    expect(partialPath([path[0]!, path[0]!], 0.5)).toEqual([path[0], path[0]]);
  });

  it('clamps the fraction to 0..1', () => {
    expect(partialPath(path, -1)).toEqual([path[0]]);
    expect(partialPath(path, 5)).toEqual(path);
  });
});
