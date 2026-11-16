import type { Category } from '../categories';
import type { LatLng } from './polyline';

export type { LatLng };

/** What state a stop is in, for the map. See stopStates.ts for how it is decided. */
export type StopState = 'upcoming' | 'next' | 'done' | 'late' | 'waiting' | 'dropped';

/** One leg of the route (between two stops), drawn in the style of how it is travelled. */
export interface RouteLeg {
  path: LatLng[];
  mode: 'walk' | 'transit' | 'drive';
  /** Already behind the person: drawn grey, under the others. */
  travelled: boolean;
}

/** Something to show on the map. */
export interface MapMarker {
  id: string;
  position: LatLng;
  /**
   * 'stage' is a stop of the day; 'start' and 'end' are the day's two ends; 'loop' is a start
   * and an end on the same spot, drawn as one marker.
   */
  kind: 'stage' | 'start' | 'end' | 'loop';
  /** Stops: the place name. */
  name?: string;
  category?: Category;
  /** Stops: the order in the route. Without it the marker shows the category icon instead. */
  number?: number;
  /** Stops: what state the stop is in (default 'upcoming'). Shown as a badge with words, not colour alone. */
  state?: StopState;
  /** Start and end: the text on the pin, for example "Start · 9:00". */
  label?: string;
  /** Loop: the text for the end, shown under `label`. */
  endLabel?: string;
}

/** Room to leave around the content, in pixels, for the sheet or panel that covers the map. */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** One map on the page. */
export interface EngineMap {
  setMarkers(markers: MapMarker[]): void;
  /** The route as legs, each drawn in the style of how it is travelled; null clears the route. */
  setRoute(legs: RouteLeg[] | null, options: { animate: boolean; accent?: string }): void;
  /** The map's own look: 'transit' shows public transport lines faintly. */
  setBaseStyle(style: 'default' | 'transit'): void;
  /** Marks one stop as chosen (null for none). Does not move the map. */
  setSelected(id: string | null): void;
  /** Called when a stop on the map is tapped, or the map itself (null) to clear the choice. */
  onSelect(listener: (id: string | null) => void): void;
  /** Brings a stop into view if it is off screen, without changing the zoom. */
  panTo(id: string): void;
  fit(padding: Padding): void;
  destroy(): void;
}

/**
 * What the app needs from a map library. Google Maps is behind this (googleEngine.ts), so
 * everything else can be tested with a fake, and the library can change without touching screens.
 */
export interface MapEngine {
  createMap(container: HTMLElement): EngineMap;
}

export type MapEngineLoader = () => Promise<MapEngine>;
