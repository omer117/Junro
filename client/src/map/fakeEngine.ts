import { vi } from 'vitest';
import type { EngineMap, MapEngine } from './engine';

type Fake<T> = {
  [K in keyof T]: ReturnType<typeof vi.fn<Extract<T[K], (...args: never[]) => unknown>>>;
};

/** A map library for tests: it draws nothing and records everything it was asked to do. */
export function fakeEngine() {
  const created: Array<{ container: HTMLElement; map: Fake<EngineMap> }> = [];

  const engine: MapEngine = {
    createMap(container) {
      const map: Fake<EngineMap> = {
        setMarkers: vi.fn<EngineMap['setMarkers']>(),
        setRoute: vi.fn<EngineMap['setRoute']>(),
        fit: vi.fn<EngineMap['fit']>(),
        destroy: vi.fn<EngineMap['destroy']>(),
      };
      created.push({ container, map });
      return map;
    },
  };

  return { engine, created };
}
