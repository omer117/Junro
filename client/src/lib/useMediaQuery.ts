import { useEffect, useState } from 'react';

/** Whether the screen matches a CSS media query, kept up to date (for example when a phone is turned). */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState(() =>
    supported ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!supported) return;
    const list = window.matchMedia(query);
    const update = (event: { matches: boolean }) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query, supported]);

  return matches;
}
