import type { CSSProperties } from 'react';

export type PaletteId =
  'golden-hour' | 'sakura' | 'sea' | 'lemon' | 'lavender' | 'aurora' | 'temple-gold';

/**
 * An accent palette: three colours of the app. Nothing else changes with the country (not ink,
 * ground, the map, and above all not the warning colours, so a warning means the same in every
 * trip). Each palette is a mood of the place in the same soft "Golden hour" style: no flag
 * colours, and no red, because red would read as a warning.
 */
export interface Palette {
  id: PaletteId;
  name: string;
  accent: string;
  skyWarm: string;
  skyTop: string;
}

/** `golden-hour` must equal --accent, --sky-warm and --sky-top in tokens.css (a test checks it). */
export const PALETTES: Record<PaletteId, Palette> = {
  'golden-hour': {
    id: 'golden-hour',
    name: 'Golden hour',
    accent: '#F59A4A',
    skyWarm: '#FBE9D7',
    skyTop: '#DCE8F6',
  },
  sakura: {
    id: 'sakura',
    name: 'Sakura',
    accent: '#F4A3B8',
    skyWarm: '#FBE6EC',
    skyTop: '#E3E6F5',
  },
  sea: { id: 'sea', name: 'Sea', accent: '#6EC1E4', skyWarm: '#F6EBD9', skyTop: '#D8EDF6' },
  lemon: { id: 'lemon', name: 'Lemon', accent: '#EDC548', skyWarm: '#FAF0D2', skyTop: '#DDE9F2' },
  lavender: {
    id: 'lavender',
    name: 'Lavender',
    accent: '#B7A4F2',
    skyWarm: '#F1EAF9',
    skyTop: '#E0E4F6',
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    accent: '#6FD6AE',
    skyWarm: '#E3F4EC',
    skyTop: '#D9E6F4',
  },
  'temple-gold': {
    id: 'temple-gold',
    name: 'Temple gold',
    accent: '#F2BE3C',
    skyWarm: '#FBEFD3',
    skyTop: '#DDE8F4',
  },
};

/** Which palette a country gets (ISO 3166-1 alpha-2). Adding a country is one line. */
export const COUNTRY_PALETTES: Partial<Record<string, PaletteId>> = {
  JP: 'sakura',
  IL: 'sea',
  IT: 'lemon',
  FR: 'lavender',
  IS: 'aurora',
  NO: 'aurora',
  TH: 'temple-gold',
};

/** The palette for a trip's destination country; any other country (or none) is Golden hour. */
export function paletteFor(countryCode: string | null | undefined): Palette {
  const id = countryCode ? COUNTRY_PALETTES[countryCode.toUpperCase()] : undefined;
  return PALETTES[id ?? 'golden-hour'];
}

/**
 * The palette as inline custom properties. Put on a wrapper, every `var(--accent)` below it
 * changes and nothing needs a prop. Exactly three properties: the warning tokens are never here.
 */
export function paletteStyle(palette: Palette): CSSProperties {
  return {
    '--accent': palette.accent,
    '--sky-warm': palette.skyWarm,
    '--sky-top': palette.skyTop,
  } as CSSProperties;
}
