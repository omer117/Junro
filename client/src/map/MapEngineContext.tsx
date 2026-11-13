import { createContext, useContext, type ReactNode } from 'react';
import type { MapEngineLoader } from './engine';

/** Why the map could not be loaded. */
export class MapEngineError extends Error {
  constructor(readonly reason: 'not_configured' | 'load_failed') {
    super(reason);
    this.name = 'MapEngineError';
  }
}

/** By default the real Google map is loaded, and only when a map is first needed. */
const googleLoader: MapEngineLoader = async () => {
  const { loadGoogleEngine } = await import('./googleEngine');
  return loadGoogleEngine();
};

const MapEngineContext = createContext<MapEngineLoader>(googleLoader);

/** Lets tests (and later, other screens) choose which map library is used. */
export function MapEngineProvider({
  loader,
  children,
}: {
  loader: MapEngineLoader;
  children: ReactNode;
}) {
  return <MapEngineContext.Provider value={loader}>{children}</MapEngineContext.Provider>;
}

export function useMapEngineLoader(): MapEngineLoader {
  return useContext(MapEngineContext);
}
