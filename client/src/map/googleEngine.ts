import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { EngineMap, MapEngine, MapMarker, Padding } from './engine';
import { MapEngineError } from './MapEngineContext';
import { createMarkerElement } from './markerElement';
import { mapStyle } from './mapStyle';
import { decodePolyline, partialPath, type LatLng } from './polyline';

const ROUTE_COLOUR = '#f59a4a';
const ROUTE_OUTLINE = '#b8bdd0';
const ROUTE_ANIMATION_MS = 1400;

/**
 * The real map, from the Google Maps JavaScript API. The browser key (restricted to this site
 * and to this one API) is read from the environment; without it the map explains what is missing.
 */
export async function loadGoogleEngine(): Promise<MapEngine> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  if (!key) throw new MapEngineError('not_configured');

  try {
    setOptions({ key, v: 'weekly' });
    const { Map, OverlayView, Polyline } = (await importLibrary('maps')) as google.maps.MapsLibrary;
    const { LatLngBounds } = (await importLibrary('core')) as google.maps.CoreLibrary;

    /** An HTML element pinned to a map position. */
    class HtmlMarker extends OverlayView {
      constructor(
        private readonly position: LatLng,
        private readonly element: HTMLElement,
      ) {
        super();
      }
      override onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(this.element);
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
        let lines: google.maps.Polyline[] = [];
        let routePath: LatLng[] = [];
        let frame = 0;

        const clearRoute = () => {
          cancelAnimationFrame(frame);
          for (const line of lines) line.setMap(null);
          lines = [];
        };

        return {
          setMarkers(markers: MapMarker[]) {
            for (const overlay of overlays) overlay.setMap(null);
            positions = markers.map((m) => m.position);
            overlays = markers.map((marker) => {
              const overlay = new HtmlMarker(marker.position, createMarkerElement(marker));
              overlay.setMap(map);
              return overlay;
            });
          },

          setRoute(line, { animate }) {
            clearRoute();
            routePath = line ? decodePolyline(line) : [];
            if (routePath.length < 2) return;

            const draw = (path: LatLng[]) => {
              if (lines.length === 0) {
                // A wider grey line under the orange one gives the outline from the design.
                lines = [
                  new Polyline({
                    map,
                    path,
                    strokeColor: ROUTE_OUTLINE,
                    strokeWeight: 10,
                    strokeOpacity: 0.7,
                    zIndex: 1,
                  }),
                  new Polyline({
                    map,
                    path,
                    strokeColor: ROUTE_COLOUR,
                    strokeWeight: 6,
                    zIndex: 2,
                  }),
                ];
              } else {
                for (const polyline of lines) polyline.setPath(path);
              }
            };

            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!animate || reduceMotion) {
              draw(routePath);
              return;
            }

            const started = performance.now();
            const step = (now: number) => {
              const fraction = Math.min(1, (now - started) / ROUTE_ANIMATION_MS);
              draw(partialPath(routePath, fraction));
              if (fraction < 1) frame = requestAnimationFrame(step);
            };
            frame = requestAnimationFrame(step);
          },

          fit(padding: Padding) {
            const all = [...positions, ...routePath];
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
            for (const overlay of overlays) overlay.setMap(null);
            overlays = [];
          },
        };
      },
    };
  } catch {
    throw new MapEngineError('load_failed');
  }
}
