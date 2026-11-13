import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/api';
import type { Airport } from './types';

/** Follows `value`, but only after it has stopped changing for `ms`. Keeps typing from searching on every key. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (ms === 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Airports matching the text. Nothing is asked for fewer than two letters. */
export function useAirportSearch(text: string) {
  const q = text.trim();
  return useQuery({
    queryKey: ['airports', q],
    queryFn: () => api<Airport[]>(`/airports?q=${encodeURIComponent(q)}&limit=6`),
    enabled: q.length >= 2,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}
