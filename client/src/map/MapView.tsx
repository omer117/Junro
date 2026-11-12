import { useEffect, useRef, useState } from 'react';
import type { EngineMap, MapMarker, Padding } from './engine';
import { MapEngineError, useMapEngineLoader } from './MapEngineContext';

export interface MapViewProps {
  markers: MapMarker[];
  /** The encoded route line from the server, or null/undefined for none. */
  routeLine?: string | null;
  /** Draw the route growing across the map, instead of showing it at once. */
  animateRoute?: boolean;
  /** Space to keep clear around the content (the sheet or panel that covers part of the map). */
  padding?: Padding;
}

const NO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 };

type State = 'loading' | 'ready' | 'not_configured' | 'failed';

/** A map that fills its parent. The parent decides the size. */
export function MapView({
  markers,
  routeLine = null,
  animateRoute = false,
  padding = NO_PADDING,
}: MapViewProps) {
  const loadEngine = useMapEngineLoader();
  const canvas = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<EngineMap | null>(null);
  const [state, setState] = useState<State>('loading');

  // One map for as long as this view is on screen.
  useEffect(() => {
    let cancelled = false;
    let created: EngineMap | null = null;

    loadEngine().then(
      (engine) => {
        // The view may have left the screen while the library was loading.
        if (cancelled || !canvas.current) return;
        created = engine.createMap(canvas.current);
        setMap(created);
        setState('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof MapEngineError && error.reason === 'not_configured'
            ? 'not_configured'
            : 'failed',
        );
      },
    );

    return () => {
      cancelled = true;
      created?.destroy();
      setMap(null);
    };
  }, [loadEngine]);

  useEffect(() => {
    if (!map) return;
    map.setMarkers(markers);
    map.setRoute(routeLine, { animate: animateRoute });
    map.fit(padding);
    // `padding` is compared by value so a new object with the same numbers does not refit.
  }, [
    map,
    markers,
    routeLine,
    animateRoute,
    padding.top,
    padding.right,
    padding.bottom,
    padding.left,
  ]);

  return (
    <div className="map-view" role="region" aria-label="Map">
      <div className="map-view__canvas" ref={canvas} />
      {state === 'loading' && (
        <p className="map-view__message" role="status">
          Loading map…
        </p>
      )}
      {state === 'not_configured' && (
        <p className="map-view__message" role="alert">
          The map needs a Google Maps key. Add VITE_GOOGLE_MAPS_BROWSER_KEY to client/.env.local.
        </p>
      )}
      {state === 'failed' && (
        <p className="map-view__message" role="alert">
          The map could not be loaded. Check your connection and try again.
        </p>
      )}
    </div>
  );
}
