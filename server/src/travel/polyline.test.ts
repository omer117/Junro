import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, joinPolylines } from './polyline.js';

// Google's documented example: three points and the string that stands for them.
const GOOGLE_EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const POINTS = [
  { lat: 38.5, lng: -120.2 },
  { lat: 40.7, lng: -120.95 },
  { lat: 43.252, lng: -126.453 },
];

describe('polyline', () => {
  it('reads the string Google documents', () => {
    expect(decodePolyline(GOOGLE_EXAMPLE)).toEqual(POINTS);
  });

  it('writes it back exactly', () => {
    expect(encodePolyline(POINTS)).toBe(GOOGLE_EXAMPLE);
  });

  it('joins lines that follow each other into one, without repeating the point where they meet', () => {
    const first = encodePolyline([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ]);
    const second = encodePolyline([
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);

    expect(decodePolyline(joinPolylines([first, second]))).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
  });

  it('keeps the point where lines meet when they do not quite touch', () => {
    const first = encodePolyline([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
    ]);
    const second = encodePolyline([
      { lat: 2.0005, lng: 2 },
      { lat: 3, lng: 3 },
    ]);

    expect(decodePolyline(joinPolylines([first, second]))).toHaveLength(4);
  });
});
