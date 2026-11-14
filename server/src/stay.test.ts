import { describe, expect, it } from 'vitest';
import { SYSTEM_MINIMUM_STAY, resolveStayMinutes } from './stay.js';
import { CATEGORIES } from './db/schema.js';

describe('SYSTEM_MINIMUM_STAY', () => {
  it('has a positive minimum for every category', () => {
    for (const category of CATEGORIES) {
      expect(SYSTEM_MINIMUM_STAY[category]).toBeGreaterThan(0);
    }
  });
});

describe('transit stop', () => {
  it('is a quick pass-through: five minutes, and a smaller preference is raised to it', () => {
    expect(SYSTEM_MINIMUM_STAY.transit).toBe(5);
    expect(resolveStayMinutes({ category: 'transit' })).toBe(5);
    expect(resolveStayMinutes({ category: 'transit', preference: 2 })).toBe(5);
  });
});

describe('resolveStayMinutes', () => {
  const museumMinimum = SYSTEM_MINIMUM_STAY.museum;

  it('uses the system minimum when nothing else is set', () => {
    expect(resolveStayMinutes({ category: 'museum' })).toBe(museumMinimum);
  });

  it("uses the user's preference over the minimum", () => {
    expect(resolveStayMinutes({ category: 'museum', preference: museumMinimum + 60 })).toBe(
      museumMinimum + 60,
    );
  });

  it('uses the stage override over everything', () => {
    expect(
      resolveStayMinutes({ category: 'museum', preference: museumMinimum + 60, override: 15 }),
    ).toBe(15);
  });

  it('never lets a preference fall below the minimum', () => {
    expect(resolveStayMinutes({ category: 'museum', preference: 1 })).toBe(museumMinimum);
  });

  it('treats null like "not set"', () => {
    expect(resolveStayMinutes({ category: 'museum', preference: null, override: null })).toBe(
      museumMinimum,
    );
  });
});
