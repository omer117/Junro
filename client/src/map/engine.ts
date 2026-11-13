import type { Category } from '../categories';
import type { LatLng } from './polyline';

export type { LatLng };

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
  /** Stops: this stop has a problem (opening hours). Shown with a warning colour. */
  warning?: boolean;
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
  /** `line` is the encoded polyline the server sends, or null to clear the route. */
  setRoute(line: string | null, options: { animate: boolean }): void;
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
