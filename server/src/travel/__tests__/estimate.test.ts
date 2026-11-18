import { describe, expect, it } from 'vitest';
import { estimateTravelTime } from '../estimate.js';

// About 1 km east of the origin at latitude 0 is 0.008983 degrees of longitude.
const origin = { lat: 0, lng: 0 };
const oneKm = { lat: 0, lng: 0.008983 };

describe('estimateTravelTime (no Google, just distance)', () => {
  it('is zero for the same place', () => {
    expect(estimateTravelTime('walking')(origin, origin, 0)).toBe(0);
    expect(estimateTravelTime('driving')(origin, origin, 0)).toBe(0);
  });

  it('walks 1 km in about 17 minutes (4.5 km/h with a 1.3 detour)', () => {
    expect(estimateTravelTime('walking')(origin, oneKm, 0)).toBeCloseTo(17.3, 0);
  });

  it('drives 1 km in about 8 minutes (25 km/h with a 1.4 detour, plus 5 minutes)', () => {
    expect(estimateTravelTime('driving')(origin, oneKm, 0)).toBeCloseTo(8.4, 0);
  });

  it('takes the faster of walking and public transport, so a short hop is on foot', () => {
    const transit = estimateTravelTime('transit');
    const walk = estimateTravelTime('walking');

    const halfKm = { lat: 0, lng: 0.0045 };
    expect(transit(origin, halfKm, 0)).toBe(walk(origin, halfKm, 0));
    // 10 km: public transport (10 min + 1.4 x 30 min = 52) beats walking (about 173 min).
    const far = { lat: 0, lng: 0.08983 };
    expect(transit(origin, far, 0)).toBeLessThan(walk(origin, far, 0));
  });

  it('does not depend on the time of day', () => {
    const estimate = estimateTravelTime('transit');
    expect(estimate(origin, oneKm, 0)).toBe(estimate(origin, oneKm, 900));
  });

  it('is the same both ways', () => {
    const estimate = estimateTravelTime('driving');
    expect(estimate(origin, oneKm, 0)).toBe(estimate(oneKm, origin, 0));
  });
});
