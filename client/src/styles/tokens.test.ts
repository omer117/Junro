import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

/** Reads the colours straight out of tokens.css, so the file stays the single source. */
function readColours(): Record<string, string> {
  const tokensCss = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf-8');
  const colours: Record<string, string> = {};
  for (const match of tokensCss.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    colours[match[1]!] = match[2]!.toUpperCase();
  }
  return colours;
}

const colours = readColours();

describe('design tokens', () => {
  it('has the colours from the design canvas', () => {
    expect(colours['ink']).toBe('#1E1B3A');
    expect(colours['ground']).toBe('#EEF1F6');
    expect(colours['accent']).toBe('#F59A4A');
    expect(colours['warning']).toBe('#C2410C');
    expect(colours['warning-text']).toBe('#B23A0A');
  });

  // Text must reach 4.5:1 against what it sits on (WCAG AA, normal size text).
  it.each([
    ['ink', 'ground'],
    ['ink', 'surface'],
    ['ink-muted', 'ground'],
    ['ink-muted', 'surface'],
    ['warning-text', 'surface'],
    ['warning-text', 'ground'],
    ['on-ink', 'ink'],
    ['accent', 'ink'],
    ['ink', 'accent'],
    ['on-warning', 'warning'],
  ])('%s text on %s is readable (at least 4.5:1)', (foreground, background) => {
    expect(colours[foreground], `missing --${foreground}`).toBeDefined();
    expect(colours[background], `missing --${background}`).toBeDefined();

    expect(contrastRatio(colours[foreground]!, colours[background]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for the same colour', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('does not depend on which colour is the text', () => {
    expect(contrastRatio('#1E1B3A', '#EEF1F6')).toBeCloseTo(
      contrastRatio('#EEF1F6', '#1E1B3A'),
      10,
    );
  });
});
