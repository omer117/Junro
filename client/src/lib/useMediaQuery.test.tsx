import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    change(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
    listeners,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useMediaQuery', () => {
  it('is false where the browser cannot tell (so the phone layout is the default)', () => {
    vi.stubGlobal('matchMedia', undefined);

    const { result } = renderHook(() => useMediaQuery('(min-width: 52rem)'));

    expect(result.current).toBe(false);
  });

  it('starts with what the screen is now', () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery('(min-width: 52rem)'));

    expect(result.current).toBe(true);
  });

  it('follows the screen when it changes, for example a phone turned sideways', () => {
    const screen = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 52rem)'));

    act(() => screen.change(true));
    expect(result.current).toBe(true);
    act(() => screen.change(false));
    expect(result.current).toBe(false);
  });

  it('stops listening when it goes away', () => {
    const screen = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 52rem)'));
    expect(screen.listeners.size).toBe(1);

    unmount();

    expect(screen.listeners.size).toBe(0);
  });
});
