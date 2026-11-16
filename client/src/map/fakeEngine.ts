import { vi } from 'vitest';
import type { EngineMap, MapEngine } from './engine';

type Fake<T> = {
  [K in keyof T]: ReturnType<typeof vi.fn<Extract<T[K], (...args: never[]) => unknown>>>;
};

/**
 * A map library for tests: it draws nothing and records everything it was asked to do.
 * `select(id)` stands in for a tap on a stop (or on the map, with null).
 */
export function fakeEngine() {
  const created: Array<{
    container: HTMLElement;
    map: Fake<EngineMap>;
    select: (id: string | null) => void;
  }> = [];

  const engine: MapEngine = {
    createMap(container) {
      const map: Fake<EngineMap> = {
        setMarkers: vi.fn<EngineMap['setMarkers']>(),
        setRoute: vi.fn<EngineMap['setRoute']>(),
        setBaseStyle: vi.fn<EngineMap['setBaseStyle']>(),
        setSelected: vi.fn<EngineMap['setSelected']>(),
        onSelect: vi.fn<EngineMap['onSelect']>(),
        panTo: vi.fn<EngineMap['panTo']>(),
        fit: vi.fn<EngineMap['fit']>(),
        destroy: vi.fn<EngineMap['destroy']>(),
      };
      const listeners: Array<(id: string | null) => void> = [];
      map.onSelect.mockImplementation((listener) => void listeners.push(listener));
      created.push({ container, map, select: (id) => listeners.forEach((l) => l(id)) });
      return map;
    },
  };

  return { engine, created };
}
