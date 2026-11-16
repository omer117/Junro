import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { EngineMap, MapEngine, MapMarker, Padding, RouteLeg } from './engine';
import { memoizeAsync } from '../lib/memoizeAsync';
import { MapEngineError } from './MapEngineContext';
import { createMarkerElement, setMarkerSelected } from './markerElement';
import { mapStyle, transitStyle } from './mapStyle';
import { partialPath, type LatLng } from './polyline';

const ROUTE_COLOUR = '#f59a4a';
const ROUTE_OUTLINE = '#b8bdd0';
const DRIVE_OUTLINE = '#1e1b3a';
const TRAVELLED_COLOUR = '#c9cee0';
const ROUTE_ANIMATION_MS = 1400;

/**
 * The real map, from the Google Maps JavaScript API. The browser key (restricted to this site
 * and to this one API) is read from the environment; without it the map explains what is missing.
 *
 * The library is set up once for the whole page: asking again (a second map on screen, or the
 * same screen opened again) gets the same engine, because setOptions may only be called once.
 *
 * Everything drawn here (markers, lines, styles, the reveal) happens in the browser, so it costs
 * nothing beyond the one map load. There is no Map ID: the JSON style and the HTML markers stay.
 */
export const loadGoogleEngine = memoizeAsync(createGoogleEngine);

/** The line, per leg, with the mode of that leg: what to draw and in which order. */
function legLines(
  leg: RouteLeg,
  path: LatLng[],
  map: google.maps.Map,
  Polyline: typeof google.maps.Polyline,
  SymbolPath: typeof google.maps.SymbolPath,
): google.maps.Polyline[] {
  if (leg.travelled) {
    return [
      new Polyline({
        map,
        path,
        strokeColor: TRAVELLED_COLOUR,
        strokeWeight: 5,
        zIndex: 0,
      }),
    ];
  }
  if (leg.mode === 'walk') {
    // Walking is dotted: no line, just a row of accent dots (the icons repeat along the path).
    return [
      new Polyline({
        map,
        path,
        strokeOpacity: 0,
        zIndex: 2,
        icons: [
          {
            icon: {
              path: SymbolPath.CIRCLE,
              fillColor: ROUTE_COLOUR,
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 1,
              scale: 3.5,
            },
            offset: '0',
            repeat: '12px',
          },
        ],
      }),
    ];
  }
  const driving = leg.mode === 'drive';
  return [
    new Polyline({
      map,
      path,
      strokeColor: driving ? DRIVE_OUTLINE : ROUTE_OUTLINE,
      strokeWeight: driving ? 9 : 10,
      strokeOpacity: driving ? 0.25 : 0.7,
      zIndex: 1,
    }),
    new Polyline({
      map,
      path,
      strokeColor: ROUTE_COLOUR,
      strokeWeight: driving ? 5 : 6,
      zIndex: 2,
    }),
  ];
}

async function createGoogleEngine(): Promise<MapEngine> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  if (!key) throw new MapEngineError('not_configured');

  try {
    setOptions({ key, v: 'weekly' });
    const { Map, OverlayView, Polyline } = (await importLibrary('maps')) as google.maps.MapsLibrary;
    const { LatLngBounds, SymbolPath } = (await importLibrary('core')) as google.maps.CoreLibrary;

    /** An HTML element pinned to a map position. */
    class HtmlMarker extends OverlayView {
      constructor(
        readonly id: string,
        private readonly position: LatLng,
        readonly element: HTMLElement,
      ) {
        super();
      }
      override onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(this.element);
        // A tap on a stop must not also drag or click the map underneath it.
        OverlayView.preventMapHitsAndGesturesFrom(this.element);
      }
      override draw() {
        const point = this.getProjection()?.fromLatLngToDivPixel(this.position);
        if (!point) return;
        this.element.style.left = `${point.x}px`;
        this.element.style.top = `${point.y}px`;
      }
      override onRemove() {
        this.element.remove();
      }
    }

    return {
      createMap(container): EngineMap {
        const map = new Map(container, {
          // Neutral start (the whole world); fit() moves it as soon as there is something to show.
          center: { lat: 0, lng: 0 },
          zoom: 2,
          styles: mapStyle as google.maps.MapTypeStyle[],
          disableDefaultUI: true,
          zoomControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
          backgroundColor: '#e4e8f0',
        });

        let overlays: HtmlMarker[] = [];
        let positions: LatLng[] = [];
        let positionOf = new globalThis.Map<string, LatLng>();
        let lines: google.maps.Polyline[][] = [];
        let legs: RouteLeg[] = [];
        let frame = 0;
        let selectedId: string | null = null;
        const listeners: Array<(id: string | null) => void> = [];
        const emit = (id: string | null) => listeners.forEach((listener) => listener(id));

        const applySelection = () => {
          for (const overlay of overlays) {
            setMarkerSelected(overlay.element, overlay.id === selectedId);
          }
        };

        // A tap on the map itself, or Escape, clears the choice.
        map.addListener('click', () => emit(null));
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') emit(null);
        };
        document.addEventListener('keydown', onKey);

        const clearRoute = () => {
          cancelAnimationFrame(frame);
          for (const group of lines) for (const line of group) line.setMap(null);
          lines = [];
        };

        return {
          setMarkers(markers: MapMarker[]) {
            for (const overlay of overlays) overlay.setMap(null);
            positions = markers.map((m) => m.position);
            positionOf = new globalThis.Map(markers.map((m) => [m.id, m.position]));
            overlays = markers.map((marker) => {
              const element = createMarkerElement(marker);
              // Only stops can be chosen (the two ends of the day are not buttons).
              if (marker.kind === 'stage') element.addEventListener('click', () => emit(marker.id));
              const overlay = new HtmlMarker(marker.id, marker.position, element);
              overlay.setMap(map);
              return overlay;
            });
            applySelection();
          },

          setRoute(newLegs, { animate }) {
            clearRoute();
            legs = newLegs ?? [];
            const drawable = legs.filter((leg) => leg.path.length >= 2);
            if (drawable.length === 0) return;

            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!animate || reduceMotion) {
              lines = drawable.map((leg) => legLines(leg, leg.path, map, Polyline, SymbolPath));
              return;
            }

            // The reveal walks the legs in order, one after the other, over a fixed time in total.
            // Each leg gets its share of the time by its length, and a stop fades in when the line
            // reaches it.
            const lengths = drawable.map((leg) => pathLength(leg.path));
            const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
            const ends: number[] = [];
            lengths.reduce((sum, length) => (ends.push((sum + length) / total), sum + length), 0);
            const hidden = overlays.filter((o) =>
              o.element.classList.contains('map-marker--numbered'),
            );
            for (const overlay of hidden) overlay.element.style.opacity = '0';

            lines = drawable.map(() => []);
            const started = performance.now();
            const step = (now: number) => {
              const fraction = Math.min(1, (now - started) / ROUTE_ANIMATION_MS);
              drawable.forEach((leg, i) => {
                const from = i === 0 ? 0 : ends[i - 1]!;
                const share = ends[i]! - from;
                const progress =
                  share === 0 ? 1 : Math.min(1, Math.max(0, (fraction - from) / share));
                if (progress <= 0) return;
                const path = partialPath(leg.path, progress);
                if (lines[i]!.length === 0) {
                  lines[i] = legLines(leg, path, map, Polyline, SymbolPath);
                } else {
                  for (const polyline of lines[i]!) polyline.setPath(path);
                }
                // The stop at the end of this leg appears when the line gets there.
                if (progress >= 1) {
                  const number = String(i + 1);
                  for (const overlay of hidden) {
                    if (
                      overlay.element.querySelector('.map-marker__number')?.textContent === number
                    ) {
                      overlay.element.style.opacity = '1';
                    }
                  }
                }
              });
              if (fraction < 1) frame = requestAnimationFrame(step);
              else for (const overlay of hidden) overlay.element.style.opacity = '1';
            };
            frame = requestAnimationFrame(step);
          },

          setBaseStyle(style) {
            map.setOptions({
              styles: (style === 'transit' ? transitStyle : mapStyle) as google.maps.MapTypeStyle[],
            });
          },

          setSelected(id) {
            selectedId = id;
            applySelection();
          },

          onSelect(listener) {
            listeners.push(listener);
          },

          panTo(id) {
            const position = positionOf.get(id);
            if (!position) return;
            // Only when it is off screen: the person keeps their zoom and place on the map.
            const bounds = map.getBounds();
            if (!bounds || !bounds.contains(position)) map.panTo(position);
          },

          fit(padding: Padding) {
            const all = [...positions, ...legs.flatMap((leg) => leg.path)];
            if (all.length === 0) return;
            if (all.length === 1) {
              map.setCenter(all[0]!);
              map.setZoom(15);
              return;
            }
            const bounds = new LatLngBounds();
            for (const point of all) bounds.extend(point);
            map.fitBounds(bounds, padding);
          },

          destroy() {
            clearRoute();
            document.removeEventListener('keydown', onKey);
            for (const overlay of overlays) overlay.setMap(null);
            overlays = [];
            listeners.length = 0;
          },
        };
      },
    };
  } catch {
    throw new MapEngineError('load_failed');
  }
}

/** Rough length of a path, to share the reveal time between legs. */
function pathLength(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i]!.lat - path[i - 1]!.lat, path[i]!.lng - path[i - 1]!.lng);
  }
  return total;
}
