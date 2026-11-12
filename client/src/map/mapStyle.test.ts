import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_COLOURS, mapStyle } from './mapStyle';

const tokens = readFileSync(join(import.meta.dirname, '../styles/tokens.css'), 'utf-8');
const token = (name: string) =>
  new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)![1]!.toUpperCase();

describe('map style', () => {
  it('uses exactly the map colours of the design tokens', () => {
    expect(MAP_COLOURS.land.toUpperCase()).toBe(token('map-land'));
    expect(MAP_COLOURS.road.toUpperCase()).toBe(token('map-road'));
    expect(MAP_COLOURS.park.toUpperCase()).toBe(token('map-park'));
    expect(MAP_COLOURS.water.toUpperCase()).toBe(token('map-water'));
  });

  const rule = (featureType: string, elementType = 'geometry') =>
    mapStyle.find((r) => r.featureType === featureType && r.elementType === elementType);

  it('paints land, roads, parks and water in the palette', () => {
    expect(rule('landscape')?.stylers).toContainEqual({ color: MAP_COLOURS.land });
    expect(rule('road')?.stylers).toContainEqual({ color: MAP_COLOURS.road });
    expect(rule('poi.park')?.stylers).toContainEqual({ color: MAP_COLOURS.park });
    expect(rule('water')?.stylers).toContainEqual({ color: MAP_COLOURS.water });
  });

  it('hides businesses and transit so only the stops the user chose stand out', () => {
    expect(rule('poi.business', 'all')?.stylers).toContainEqual({ visibility: 'off' });
    expect(rule('transit', 'all')?.stylers).toContainEqual({ visibility: 'off' });
  });
});
