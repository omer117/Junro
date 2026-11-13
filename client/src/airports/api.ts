import { useQuery } from '@tanstack/react-query';
import { api } from '../api/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { Airport } from './types';

export { useDebouncedValue };

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
