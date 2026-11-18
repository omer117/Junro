import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE } from '../contrast';
import { COUNTRY_PALETTES, PALETTES, paletteFor, paletteStyle } from '../palettes';

/** The colours straight out of tokens.css, the single source (same way as tokens.test.ts). */
const tokens = (() => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf-8');
  const colours: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    colours[match[1]!] = match[2]!.toUpperCase();
  }
  return colours;
})();

const palettes = Object.values(PALETTES);

describe('the default palette', () => {
  it('is Golden hour, exactly what tokens.css says (one source of truth)', () => {
    const golden = PALETTES['golden-hour'];

    expect(golden.accent.toUpperCase()).toBe(tokens['accent']);
    expect(golden.skyWarm.toUpperCase()).toBe(tokens['sky-warm']);
    expect(golden.skyTop.toUpperCase()).toBe(tokens['sky-top']);
  });

  it('is what an unknown country, no country and a missing country get', () => {
    const golden = PALETTES['golden-hour'];

    expect(paletteFor('ZZ')).toBe(golden);
    expect(paletteFor(undefined)).toBe(golden);
    expect(paletteFor(null)).toBe(golden);
    expect(paletteFor('')).toBe(golden);
  });
});

describe.each(palettes)('the palette "$id"', (palette) => {
  const colours: Record<string, string> = {
    ...tokens,
    accent: palette.accent,
    'sky-warm': palette.skyWarm,
    'sky-top': palette.skyTop,
  };

  // Every text/background pair of tokens.test.ts that uses one of the three changed tokens.
  it.each([
    ['accent', 'ink'],
    ['ink', 'accent'],
    ['ink', 'sky-top'],
    ['ink-muted', 'sky-top'],
    ['ink', 'sky-warm'],
    ['ink-muted', 'sky-warm'],
    ['warning-text', 'sky-warm'],
  ])('%s text on %s is readable (at least 4.5:1)', (foreground, background) => {
    expect(
      contrastRatio(colours[foreground]!.toUpperCase(), colours[background]!.toUpperCase()),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('has an accent that cannot be mistaken for the warning colour (distance of at least 30)', () => {
    expect(deltaE(palette.accent, tokens['warning']!)).toBeGreaterThanOrEqual(30);
  });

  it('has valid colours', () => {
    for (const colour of [palette.accent, palette.skyWarm, palette.skyTop]) {
      expect(colour).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(palette.name).toMatch(/\w/);
  });
});

describe('paletteStyle', () => {
  it('sets exactly the three custom properties and nothing else (warnings never change)', () => {
    const style = paletteStyle(PALETTES.sakura) as Record<string, string>;

    expect(Object.keys(style).sort()).toEqual(['--accent', '--sky-top', '--sky-warm']);
    expect(style['--accent']).toBe(PALETTES.sakura.accent);
    expect(style['--sky-warm']).toBe(PALETTES.sakura.skyWarm);
    expect(style['--sky-top']).toBe(PALETTES.sakura.skyTop);
  });
});

describe('the country map', () => {
  it('has only two upper-case letters as keys, each pointing to a palette that exists', () => {
    for (const [country, id] of Object.entries(COUNTRY_PALETTES)) {
      expect(country).toMatch(/^[A-Z]{2}$/);
      expect(PALETTES[id!], `${country} -> ${id}`).toBeDefined();
    }
  });

  it('gives the countries of the starting set their palettes', () => {
    expect(paletteFor('JP').id).toBe('sakura');
    expect(paletteFor('IL').id).toBe('sea');
    expect(paletteFor('IT').id).toBe('lemon');
    expect(paletteFor('FR').id).toBe('lavender');
    expect(paletteFor('IS').id).toBe('aurora');
    expect(paletteFor('NO').id).toBe('aurora');
    expect(paletteFor('TH').id).toBe('temple-gold');
  });

  it('looks a country up without regard to case', () => {
    expect(paletteFor('jp').id).toBe('sakura');
  });
});

describe('deltaE (colour distance, CIE76)', () => {
  it('is 0 for the same colour and about 100 between black and white', () => {
    expect(deltaE('#336699', '#336699')).toBeCloseTo(0, 5);
    expect(deltaE('#000000', '#FFFFFF')).toBeCloseTo(100, 0);
  });

  it('is the same both ways, and bigger for colours that look more different', () => {
    expect(deltaE('#F59A4A', '#C2410C')).toBeCloseTo(deltaE('#C2410C', '#F59A4A'), 8);
    expect(deltaE('#F59A4A', '#C2410C')).toBeGreaterThan(deltaE('#F59A4A', '#F4A04F'));
  });
});
